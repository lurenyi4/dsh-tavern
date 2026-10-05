import {posix,win32} from 'node:path';
import {homedir} from 'node:os';
export function checkNodeVersion(version=process.versions.node){
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return false;
 const [major,minor]=version.split('.').map(Number);
 return major>24||(major===24&&minor>=19);
}
export function dataDirectory({platform=process.platform,home=homedir(),env=process.env}={}){
 if(env.STORY_DATA_DIR)return env.STORY_DATA_DIR;
 if(platform==='win32')return win32.join(env.LOCALAPPDATA||win32.join(home,'AppData','Local'),'Story Runtime');
 if(platform==='darwin')return posix.join(home,'Library','Application Support','Story Runtime');
 const base=env.XDG_DATA_HOME&&posix.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:posix.join(home,'.local','share');
 return posix.join(base,'story-runtime');
}
