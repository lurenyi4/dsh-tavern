import {dirname,join} from 'node:path';import {existsSync} from 'node:fs';
// npm.cmd needs a command shell on Windows. Prefer Node + the official npm CLI
// instead, so repository paths are argument values, never shell source.
export function npmCommand({platform=process.platform,execPath=process.execPath,env=process.env,exists=existsSync}={}){
 if(platform!=='win32')return {command:'npm',prefix:[]};
 const candidates=[env.npm_execpath,join(dirname(execPath),'node_modules','npm','bin','npm-cli.js')].filter(x=>typeof x==='string'&&/[\\/]npm-cli\.js$/.test(x));
 const cli=candidates.find(exists);if(!cli)throw Object.assign(new Error('Run npm run install:world-runtime using the official Node/npm installation; npm CLI path was not found.'),{code:'NPM_CLI_NOT_FOUND'});
 return {command:execPath,prefix:[cli]};
}
