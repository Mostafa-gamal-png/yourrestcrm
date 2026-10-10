import {sqliteDatabase,privateObjects} from './storage.mjs';
import {configuredLocalMailer} from './local-mail.mjs';
import {passengerClient} from './passenger-client.mjs';
let db,bucket;
function database(){
 if(!process.env.YR_DATABASE_PATH)throw Error('YR_DATABASE_PATH is required');
 return db??=sqliteDatabase(process.env.YR_DATABASE_PATH);
}
function objects(){
 if(!process.env.YR_OBJECTS_PATH)throw Error('YR_OBJECTS_PATH is required');
 return bucket??=privateObjects(process.env.YR_OBJECTS_PATH);
}
// Build-time adapter: no Sites identity headers or runtime authentication bypass.
export const env={
 YR_AUTH_MODE:'email-otp',
 get YR_APP_ORIGIN(){return process.env.YR_APP_ORIGIN;},
 get YR_AUTH_SECRET(){return process.env.YR_AUTH_SECRET;},
 get YR_NATIONAL_ADDRESS_API_KEY(){return process.env.YR_NATIONAL_ADDRESS_API_KEY;},
 get DB(){return database();},
 get FILES(){return objects();},
 get YR_SEND_OTP(){return configuredLocalMailer();},
 YR_AUTH_CLIENT_KEY:passengerClient
};
