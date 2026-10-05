import test from 'node:test';import assert from 'node:assert/strict';
import {dataDirectory,checkNodeVersion} from '../src/platform.mjs';
test('portable defaults use native platform user-data paths without remote-server substitution',()=>{assert.equal(dataDirectory({platform:'linux',home:'/home/a',env:{}}),'/home/a/.local/share/story-runtime');assert.equal(dataDirectory({platform:'darwin',home:'/Users/a',env:{}}),'/Users/a/Library/Application Support/Story Runtime');assert.equal(dataDirectory({platform:'win32',home:'C:\\Users\\a',env:{LOCALAPPDATA:'C:\\Users\\a\\AppData\\Local'}}),'C:\\Users\\a\\AppData\\Local\\Story Runtime');assert.equal(dataDirectory({platform:'android',home:'/data/user/home',env:{}}),'/data/user/home/.local/share/story-runtime');});
test('runtime requirement is explicit and no platform is inferred tested from path checks',()=>{assert.equal(checkNodeVersion('24.19.0'),true);assert.equal(checkNodeVersion('25.0.0'),true);assert.equal(checkNodeVersion('24.18.1'),false);});
test('path calculation is host-independent and preserves explicit overrides',()=>{
 assert.equal(dataDirectory({platform:'win32',home:'C:\\Users\\用户',env:{}}),'C:\\Users\\用户\\AppData\\Local\\Story Runtime');
 assert.equal(dataDirectory({platform:'darwin',home:'/Users/用户',env:{}}),'/Users/用户/Library/Application Support/Story Runtime');
 assert.equal(dataDirectory({platform:'linux',home:'/home/a',env:{XDG_DATA_HOME:'/data/中文 dir'}}),'/data/中文 dir/story-runtime');
 assert.equal(dataDirectory({platform:'linux',home:'/home/a',env:{XDG_DATA_HOME:'relative'}}),'/home/a/.local/share/story-runtime');
 assert.equal(dataDirectory({platform:'win32',home:'C:\\Users\\a',env:{STORY_DATA_DIR:'D:\\故事 文件'}}),'D:\\故事 文件');
});
test('invalid and prerelease Node versions are not certified stable runtimes',()=>{
 for(const version of ['24.19','NaN.19.0','24.19.0-rc.1','24.19.0garbage','25.0.0-rc.1'])assert.equal(checkNodeVersion(version),false,version);
});
