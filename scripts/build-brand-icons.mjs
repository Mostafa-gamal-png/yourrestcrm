// Compile the existing company logo into install assets without redrawing it.
// Run with sharp available in the development environment; no runtime dependency.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const sharp=createRequire(import.meta.url)('sharp');
const publicDir=new URL('../public/',import.meta.url);
const logo=await readFile(new URL('yourrest-logo.png',publicDir));
await mkdir(new URL('icons/',publicDir),{recursive:true});
for(const [size,fill,name,legacy] of [
 [192,.84,'yourrest-company-192.png','icon-192.png'],
 [512,.84,'yourrest-company-512.png','icon-512.png'],
 // A centered square of side .56 fits fully within the maskable safe circle.
 [192,.56,'yourrest-company-maskable-192.png','maskable-192.png'],
 [512,.56,'yourrest-company-maskable-512.png','maskable-512.png'],
 [180,.84,'yourrest-company-apple.png','apple-touch-icon.png'],
]){
 const inset=await sharp(logo).resize({width:Math.floor(size*fill),height:Math.floor(size*fill),fit:'inside'}).png().toBuffer();
 const icon=await sharp({create:{width:size,height:size,channels:4,background:'#ffffff'}}).composite([{input:inset,gravity:'centre'}]).png().toBuffer();
 await writeFile(new URL('icons/'+name,publicDir),icon);
 await writeFile(new URL('icons/'+legacy,publicDir),icon);
}
const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="white"/><image x="41" y="41" width="430" height="430" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,'+logo.toString('base64')+'"/></svg>\n';
await writeFile(new URL('yourrest-company-icon.svg',publicDir),favicon);
await writeFile(new URL('favicon.svg',publicDir),favicon);
console.log('Company logo install assets compiled in '+fileURLToPath(publicDir));
