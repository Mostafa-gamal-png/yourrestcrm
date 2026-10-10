// Run this copied file from the top level of the upload package: node setup.cjs
process.umask(0o077);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<16))throw Error('Select Node.js 22.16 or later in cPanel.');
 const root=fs.realpathSync(__dirname);if(root.split(path.sep).includes('public_html'))throw Error('Move the application folder outside public_html before setup.');
 const {loadSettings,validateConfig,validatePrivatePath}=require('./release/operations/config.cjs');
 validatePrivatePath(root,{directory:true,privateMode:false});
 const lockFile=path.join(root,'.setup.lock');let lock;
 try{lock=fs.openSync(lockFile,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Setup is already running or a previous setup was interrupted. Check that no setup process is running before removing .setup.lock.');throw error;}
 try{
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.fsyncSync(lock);
 const settingsFile=path.join(root,'settings.cjs'),existing=fs.existsSync(settingsFile);
 const dataDir=path.join(path.dirname(root),'yourrest-crm-data');
 const config=existing?loadSettings(root,{allowMissingStorage:true}):validateConfig({YR_APP_ORIGIN:'https://crm.yourrest.org',YR_DATABASE_PATH:path.join(dataDir,'database.sqlite'),YR_OBJECTS_PATH:path.join(dataDir,'objects'),YR_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'ceo@yourrest.org',YR_SENDMAIL_PATH:'/usr/sbin/sendmail'},{root,allowMissingStorage:true});
 for(const p of [path.dirname(config.YR_DATABASE_PATH),config.YR_OBJECTS_PATH]){validatePrivatePath(p,{root,directory:true,allowMissing:true});fs.mkdirSync(p,{recursive:true,mode:0o700});validatePrivatePath(p,{root,directory:true});}
 if(!existing){
  const temporary=settingsFile+'.initializing-'+crypto.randomUUID(),handle=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(handle,'module.exports='+JSON.stringify(config,null,2)+';\n');fs.fsyncSync(handle);fs.closeSync(handle);fs.linkSync(temporary,settingsFile);}finally{try{fs.closeSync(handle);}catch{}fs.rmSync(temporary,{force:true});}
 }
 const {initializeDatabase}=await import('./release/operations/initialize.mjs');
 const summary=initializeDatabase({filename:config.YR_DATABASE_PATH,migrations:path.join(root,'release/drizzle'),seed:path.join(root,'migration/initial.json'),checksum:path.join(root,'migration/initial.sha256'),appRoot:root});
 console.log(JSON.stringify({ok:true,origin:config.YR_APP_ORIGIN,...summary,message:'Setup complete. Use app.cjs as Application startup file, then Restart. Email delivery must be verified on the real host.'}));
 }finally{fs.closeSync(lock);fs.unlinkSync(lockFile);}
})().catch(error=>{console.error('Setup failed: '+error.message);process.exitCode=1;});
