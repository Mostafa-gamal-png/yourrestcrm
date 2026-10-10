// Server rendering coverage for bilingual login and logout; no real browser or SMTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-auth-ui-'));
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
 const helper=fs.readFileSync(path.join(root,'lib/native-tracking.ts'),'utf8');
 fs.writeFileSync(path.join(work,'native-tracking.mjs'),ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const source=fs.readFileSync(path.join(root,'app/email-login.tsx'),'utf8').replace("import AppUpdate from './app-update';", "const AppUpdate=()=>null;").replace("import {useLanguage} from '@/lib/i18n';","const useLanguage=()=>({language:globalThis.__authTestLanguage||'ar',setLanguage:()=>{}});").replace("from '@/lib/native-tracking'","from './native-tracking.mjs'").replace("import {lockOfflineSession} from '@/lib/offline-store';","const lockOfflineSession=async()=>{};").replace("import {prepareOfflineLogout,finishPendingOfflineLogout,confirmOfflineSignIn,isOfflineLogoutPending} from '@/lib/offline-auth';","const prepareOfflineLogout=async()=>{},finishPendingOfflineLogout=async()=>false,confirmOfflineSignIn=()=>{},isOfflineLogoutPending=()=>false;");
 fs.writeFileSync(path.join(work,'login.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 const {default:EmailLogin,EmailLogout}=await import(pathToFileURL(path.join(work,'login.mjs')));
 let checks=0;
 for(const language of ['ar','en']){
  globalThis.__authTestLanguage=language;
  const login=renderToStaticMarkup(React.createElement(EmailLogin,{returnTo:'/'}));
  assert(login.includes(language==='ar'?'تسجيل الدخول':'Sign in'));checks++;
  assert(login.includes(language==='ar'?'إرسال رمز الدخول':'Send sign-in code'));checks++;
  assert(login.includes('@yourrest.org'));checks++;
  assert(login.includes('autoComplete="username"'));checks++;
  assert(login.includes(language==='ar'?'dir="rtl"':'dir="ltr"'));checks++;
  assert(!login.includes('signin-with-chatgpt'));checks++;
  assert(login.includes(language==='ar'?'سيُحفظ تسجيل الدخول على هذا المتصفح.':'Sign-in will be remembered on this browser.'));checks++;
  assert(!login.includes('30')&&!login.includes('type="checkbox"'));checks++;
  const logout=renderToStaticMarkup(React.createElement(EmailLogout));
  assert(logout.includes(language==='ar'?'تسجيل الخروج':'Sign out'));checks++;
 }
 console.log(JSON.stringify({ok:true,checks,languages:['ar','en'],type:'server-rendered login/logout'}));
}finally{delete globalThis.__authTestLanguage;fs.rmSync(work,{recursive:true,force:true});}
