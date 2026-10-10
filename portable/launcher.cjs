process.umask(0o077);
try{
 const {loadSettings,applySettings}=require('./release/operations/config.cjs');
 applySettings(loadSettings(__dirname));
}catch(error){console.error('Yourrest startup blocked: '+error.message+' Run setup.cjs if setup is incomplete.');process.exit(1);}
require('./release/app.cjs');
