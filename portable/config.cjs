// settings.cjs is the single configuration source for setup, startup and backups.
const fs=require('node:fs'),path=require('node:path');
function outside(child,parent){const relative=path.relative(parent,child);return relative.startsWith('..'+path.sep);}
function validatePrivatePath(filename,{directory=false,allowMissing=false,root,privateMode=true}={}){
 if(typeof filename!=='string'||!path.isAbsolute(filename)||filename.includes('\0'))throw Error('Persistent paths must be absolute.');
 const resolved=path.resolve(filename);
 if(resolved.split(path.sep).includes('public_html'))throw Error('Persistent paths must be outside public_html.');
 if(root&&!outside(resolved,path.resolve(root)))throw Error('Persistent paths must be outside the application folder.');
 for(let current=resolved;current!==path.dirname(current);current=path.dirname(current)){
  try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Persistent path ancestors must not be symlinks.');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let stat;try{stat=fs.lstatSync(resolved);}catch(error){if(error.code!=='ENOENT'||!allowMissing)throw error;return resolved;}
 if(directory?!stat.isDirectory():!stat.isFile())throw Error('Persistent path has an unexpected file type.');
 if(privateMode&&((stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid())))throw Error('Persistent storage must belong to this account and be private (folders 0700, files 0600).');
 return resolved;
}
function validateConfig(config,{root,allowMissingStorage=false,environment=process.env}={}){
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.entries(config).some(([key,value])=>!/^YR_[A-Z_]+$/.test(key)||typeof value!=='string'))throw Error('settings.cjs must export YR_* string settings.');
 for(const [key,value] of Object.entries(environment))if(/^YR_[A-Z_]+$/.test(key)&&value!==undefined&&config[key]!==value)throw Error('Conflicting '+key+' environment value: edit settings.cjs and remove the cPanel override.');
 const origin=new URL(config.YR_APP_ORIGIN);
 if(origin.protocol!=='https:'||origin.origin!==config.YR_APP_ORIGIN||origin.username||origin.password)throw Error('YR_APP_ORIGIN must be the exact HTTPS application origin.');
 if(!/^[a-f0-9]{64,}$/i.test(config.YR_AUTH_SECRET||''))throw Error('YR_AUTH_SECRET is invalid.');
 const database=validatePrivatePath(config.YR_DATABASE_PATH,{root,allowMissing:allowMissingStorage});
 const objects=validatePrivatePath(config.YR_OBJECTS_PATH,{root,directory:true,allowMissing:allowMissingStorage});
 validatePrivatePath(path.dirname(database),{root,directory:true,allowMissing:allowMissingStorage});
 if(database===objects||!outside(database,objects))throw Error('Keep the database outside the object-storage folder.');
 if(config.YR_MAIL_TRANSPORT!=='sendmail'||!/^[a-z0-9][a-z0-9._+-]{0,63}@yourrest\.org$/i.test(config.YR_MAIL_FROM||'')||!path.isAbsolute(config.YR_SENDMAIL_PATH||'')||/[\0\r\n]/.test(config.YR_SENDMAIL_PATH))throw Error('Local mail settings are invalid.');
 return config;
}
function loadSettings(root,{allowMissingStorage=false,environment=process.env}={}){
 const file=validatePrivatePath(path.join(root,'settings.cjs'));
 delete require.cache[file];
 return validateConfig(require(file),{root,allowMissingStorage,environment});
}
function applySettings(config){for(const [key,value] of Object.entries(config))process.env[key]=value;}
module.exports={validatePrivatePath,validateConfig,loadSettings,applySettings};
