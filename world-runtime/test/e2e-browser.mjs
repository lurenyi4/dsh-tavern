/** Real Chromium user journeys. Run separately: node --test world-runtime/test/e2e-browser.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {startServer} from '../src/server.mjs';
import {restoreBackup} from '../src/backup.mjs';
import {v2,png,mappedCharx} from '../fixtures/import-fixtures.mjs';

const installedRuntime=fileURLToPath(new URL('../.runtime/',import.meta.url));
const runtimeDir=resolve(process.env.STORY_DSH_RUNTIME_DIR || (existsSync(join(installedRuntime,'node_modules')) ? installedRuntime : fileURLToPath(new URL('../../../dsh-pinned/',import.meta.url))));
const evidenceDir=fileURLToPath(new URL('../docs/e2e-evidence/',import.meta.url));
const chromiumPath=process.env.STORY_CHROMIUM_PATH||'/usr/bin/chromium';
async function api(page,path,body,status=200){const response=body===undefined?await page.request.get(new URL(path,page.url()).href):await page.request.post(new URL(path,page.url()).href,{data:body});const value=await response.json();assert.equal(response.status(),status,`${path}: ${JSON.stringify(value)}`);return value;}
async function snapshot(page,worldId,branchId,author=false){return api(page,`/api/worlds/${worldId}?view=${author?'author':'player'}${branchId?'&branchId='+branchId:''}`);}
async function saveScreenshot(page,name){const path=join(evidenceDir,name+'.png');await page.screenshot({path,fullPage:true});return path;}

// User journeys are appended after the interface's real semantic selectors are available.

async function launchFixture(t){
 const temp=await mkdtemp(join(tmpdir(),'story-runtime-browser-e2e-'));
 await mkdir(evidenceDir,{recursive:true});
 let server=await startServer({dataDir:join(temp,'original'),port:0,runtimeDir,demoDelay:100,env:{}});
 let browser;try{browser=await chromium.launch({executablePath:chromiumPath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}catch(error){await server.close();await rm(temp,{recursive:true,force:true});throw error;}
 const context=await browser.newContext({baseURL:server.url,viewport:{width:1440,height:1000},locale:'zh-CN',acceptDownloads:true});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 const page=await context.newPage(),pageErrors=[],consoleErrors=[],externalRequests=[],steps=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push({text:message.text(),url:message.location().url});});
 await context.route('**/*',route=>{const target=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(target.hostname))return route.continue();externalRequests.push(target.href);return route.abort('blockedbyclient');});
 const startedAt=new Date().toISOString();
 t.after(async()=>{
  try{if(!page.isClosed())await saveScreenshot(page,'browser-final');await context.tracing.stop({path:join(evidenceDir,'browser-trace.zip')});await writeFile(join(evidenceDir,'browser-report.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),node:process.version,chromium:browser.version(),viewport:{width:1440,height:1000},runtimeDir,steps,pageErrors,consoleErrors,externalRequests},null,2));}
  finally{await browser.close();await server?.close();await rm(temp,{recursive:true,force:true});}
  assert.deepEqual(pageErrors,[],'page JavaScript exceptions');assert.deepEqual(externalRequests,[],'all UI requests must remain local');
  const unexpected=consoleErrors.filter(e=>!(/400 \(Bad Request\)/.test(e.text)&&/\/api\/import$/.test(e.url)));
  assert.deepEqual(unexpected,[],'unexpected browser console errors');
 });
 return {page,browser,context,temp,get server(){return server;},mark(name,detail){steps.push({name,detail,at:new Date().toISOString()});},async restart(dataDir){await page.goto('about:blank');await server.close();server=null;server=await startServer({dataDir,port:0,runtimeDir,demoDelay:100,env:{}});await page.goto(server.url);}};
}

test('Chromium desktop and mobile: real story world user journeys', {timeout:180000}, async t=>{
 const f=await launchFixture(t),{page}=f;
 await page.goto(f.server.url);
 await expect(page.getByRole('heading',{name:/故事会继续/})).toBeVisible();
 await saveScreenshot(page,'desktop-welcome');
 await page.getByRole('button',{name:/打开钟楼镇演示/}).click();
 await expect(page.locator('#worldTitle')).toHaveText('钟楼镇 · 我的故事');
 await expect(page.getByLabel('生成模式')).toHaveValue('demo');
 await expect(page.getByRole('option',{name:'真实模型 · 未配置'})).toBeDisabled();
 let worlds=(await api(page,'/api/worlds')).worlds;assert.equal(worlds.length,1);
 const w=worlds[0].id,main=worlds[0].activeBranchId,p=`/api/worlds/${w}`;
 await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(0);
 f.mark('create demo world','Real SQLite world created from the initial welcome button; no remote model configured');
 await page.getByLabel('接下来，你想做什么？').fill('前往钟楼');
 await page.getByRole('button',{name:/发送并继续/}).click();
 await expect(page.locator('#draftCard')).toBeVisible();
 await expect(page.locator('#draftText')).not.toBeEmpty();
 await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(1,{timeout:15000});
 await expect(page.locator('#draftCard')).toBeHidden();
 let s=await snapshot(page,w,main);assert.equal(s.state.characters.find(c=>c.id==='player').location,'钟楼');assert.ok(s.outbox.every(x=>x.status==='delivered'));
 const firstCommit=s.scenes[0].id;
 await expect(page.locator('#inspectorContent')).toContainText('钟楼');
 f.mark('send committed demo turn','Draft visibly streams, then formal narrative and player location commit and DSH receipt is delivered');
 await page.getByLabel('接下来，你想做什么？').fill('前往取消后不该到达的远处');
 await page.getByRole('button',{name:/发送并继续/}).click();
 await expect(page.locator('#draftCard')).toBeVisible();
 await expect(page.locator('#draftText')).toContainText(/你沿/);
 await page.getByRole('button',{name:'取消生成',exact:true}).click();
 await expect(page.locator('#runBar')).toBeHidden();
 await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(1);
 s=await snapshot(page,w,main);assert.equal(s.state.characters.find(c=>c.id==='player').location,'钟楼');assert.ok(s.runs.some(r=>r.status==='cancelled'&&r.draft.length>0));
 await page.reload();await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(1);
 await expect(page.locator('#runHistory')).toContainText(/取消/);
 f.mark('cancel partial generation','Cancellation left one formal scene and unchanged location; cancelled draft persisted across page reload');
 const nativeBefore=await snapshot(page,w,main,true);await page.getByRole('button',{name:'打个招呼',exact:true}).click();await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(nativeBefore.scenes.length+1);assert.equal((await snapshot(page,w,main,true)).state.variables.trust,nativeBefore.state.variables.trust+1);f.mark('native card action','Imported declarative action button atomically increments trust');



 const originalBeforeImport=await snapshot(page,w,main,true);
 for(const [filename,mimeType,buffer] of [['qa-st.json','application/json',Buffer.from(JSON.stringify(v2))],['qa-st.png','image/png',png([['chara',v2]])],['qa-risu.charx','application/zip',mappedCharx()]]){
  await page.locator('#fileInput').setInputFiles({name:filename,mimeType,buffer});
  await expect(page.locator('#dialog')).toBeVisible();await expect(page.locator('#dialogTitle')).toHaveText('导入完成 · 渡口向导');
  await expect(page.locator('#dialogBody .report-item')).not.toHaveCount(0);
  if(filename.endsWith('charx')){await expect(page.locator('#dialogBody')).toContainText('已映射');await expect(page.locator('#dialogBody')).toContainText('不支持');await saveScreenshot(page,'desktop-import-report');}
  await page.locator('#dialogActions').getByRole('button',{name:'关闭',exact:true}).click();
 }
 assert.equal((await api(page,'/api/cards')).cards.length,4);
 assert.deepEqual((await snapshot(page,w,main,true)).state,originalBeforeImport.state);
 const badResponse=page.waitForResponse(r=>r.url().endsWith('/api/import')&&r.status()===400);
 await page.locator('#fileInput').setInputFiles({name:'malformed.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await badResponse;
 await expect(page.locator('#notification')).toHaveClass(/error/);
 assert.equal((await snapshot(page,w,main,true)).branch.head,originalBeforeImport.branch.head);
 await expect(page.locator('#worldTitle')).toHaveText('钟楼镇 · 我的故事');
 f.mark('import and rejected malformed card','ST JSON, PNG and Risu CharX imports through actual file input and migration report; malformed JSON leaves current world unchanged');
 await page.getByRole('button',{name:'＋ 创建世界',exact:true}).click();
 await page.getByLabel('世界名称',{exact:true}).fill('导入卡的独立世界');
 const cards=(await api(page,'/api/cards')).cards;const importedCard=cards.find(c=>c.assets?.some(a=>a.mime==='image/png')&&c.name==='渡口向导');assert.ok(importedCard);
 await page.getByLabel('故事卡',{exact:true}).selectOption(importedCard.id);
 await page.getByRole('button',{name:'创建并进入',exact:true}).click();await expect(page.locator('#worldTitle')).toHaveText('导入卡的独立世界');
 await expect(page.locator('#sceneList')).toContainText('请选择一条路。');
 await page.locator(`#worldList [data-world-id="${w}"]`).click();await expect(page.locator('#worldTitle')).toHaveText('钟楼镇 · 我的故事');
 await page.getByLabel('作者视图',{exact:true}).check();await expect(page.locator('#authorAction')).toBeVisible();
 const dialog=page.locator('#dialog');
 async function action(kind,fill,narrative){
  await page.getByRole('button',{name:'＋ 提交作者操作',exact:true}).click();await dialog.getByLabel('操作类型',{exact:true}).selectOption(kind);await fill(dialog);
  await dialog.getByLabel('事件说明',{exact:true}).last().fill(narrative);
  const before=await snapshot(page,w,undefined,true);await dialog.getByRole('button',{name:'预览（不保存）',exact:true}).click();assert.equal((await snapshot(page,w,undefined,true)).branch.head,before.branch.head,'preview must not commit');
  await dialog.getByRole('button',{name:'提交世界变化',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('#sceneList [data-scene-id]')).toHaveCount(before.scenes.length+1);await expect(page.locator('#notification')).toHaveText('作者操作已正式提交。');
 }
 await action('set_variable',async d=>{await d.getByLabel('变量名',{exact:true}).fill('courage');await d.getByLabel('值（数字、布尔或文字）',{exact:true}).fill('7');},'保存勇气变量。');
 await action('change_inventory',async d=>{await d.getByLabel('人物',{exact:true}).selectOption('player');await d.getByLabel('物品名称',{exact:true}).fill('提灯');await d.getByLabel('数量变化（负数表示消耗）',{exact:true}).fill('2');},'得到两盏提灯。');
 for(const kind of ['信任','欠债'])await action('add_relation',async d=>{await d.getByLabel('关系起点',{exact:true}).selectOption('card-main');await d.getByLabel('关系终点',{exact:true}).selectOption('player');await d.getByLabel('关系类型',{exact:true}).fill(kind);await d.getByLabel('关系说明',{exact:true}).fill('明确的有向关系');},'记录人物关系。');
 const secret='UI_PRIVATE_7281';
 await action('set_fact',async d=>{await d.getByLabel('事实名称',{exact:true}).fill('隐藏储藏处');await d.getByLabel('事实内容',{exact:true}).fill(secret);await d.getByLabel('可见性',{exact:true}).selectOption('private');},'记录一项私有事实。');
 await page.getByRole('tab',{name:'世界',exact:true}).click();await expect(page.locator('#inspectorContent')).toContainText(secret);await expect(page.locator('#inspectorContent')).toContainText('提灯 × 2');await expect(page.locator('#inspectorContent')).toContainText('courage');
 await page.getByRole('tab',{name:'关系',exact:true}).click();await expect(page.locator('#inspectorContent')).toContainText('信任');await expect(page.locator('#inspectorContent')).toContainText('欠债');
 await page.getByLabel('作者视图',{exact:true}).uncheck();await page.getByRole('tab',{name:'世界',exact:true}).click();await expect(page.locator('#inspectorContent')).not.toContainText(secret);assert.ok(!JSON.stringify(await snapshot(page,w,main)).includes(secret));
 await page.getByLabel('作者视图',{exact:true}).check();await expect(page.locator('#inspectorContent')).toContainText(secret);
 f.mark('author forms and reader privacy','Preview does not persist; author commits variables, inventory and two directed relations. Author-only fact disappears from player UI and API');
 const attempts=(await snapshot(page,w,main,true)).usage.length;
 await action('schedule',async d=>{await d.getByLabel('人物',{exact:true}).selectOption('card-main');await d.getByLabel('事件说明',{exact:true}).first().fill('向导独自前往广场');await d.getByLabel('到期世界时间',{exact:true}).fill('1');await d.getByLabel('届时前往的位置',{exact:true}).fill('广场');},'安排向导行动。');
 await page.getByRole('tab',{name:'日程',exact:true}).click();await expect(page.locator('#inspectorContent')).toContainText('向导独自前往广场');
 await page.getByLabel('最多事件',{exact:true}).fill('1');await page.getByLabel('运行秒数',{exact:true}).fill('10');await page.getByRole('button',{name:'开启自主推进',exact:true}).click();
 await expect.poll(async()=>{s=await snapshot(page,w,main,true);return s.autonomy.enabled;},{timeout:6000,intervals:[100,200,500]}).toBe(false);
 assert.equal(s.autonomy.remainingEvents,0);assert.equal(s.state.characters.find(c=>c.id==='card-main').location,'广场');assert.equal(s.usage.length,attempts);assert.ok(s.state.schedules.some(q=>q.entityId==='messenger'&&q.status==='pending'));
 await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('tab',{name:'人物',exact:true}).click();await expect(page.locator('#inspectorContent')).toContainText('位置：广场');
 await page.getByLabel('目标世界时间',{exact:true}).fill('5');await page.getByRole('button',{name:'推进',exact:true}).click();await expect(page.locator('#notification')).toContainText('推进完成');
 s=await snapshot(page,w,main,true);assert.equal(s.state.characters.find(c=>c.id==='messenger').location,'杂货铺');assert.equal(s.usage.length,attempts);
 f.mark('bounded NPC scheduling without chat','One-event autonomous budget advances an NPC and stops; manual time advance executes the existing messenger event. No extra model attempts');
 await saveScreenshot(page,'desktop-author-world');
 const mainTruth=await snapshot(page,w,main,true);
 await page.locator(`[data-scene-id="${firstCommit}"]`).getByRole('button',{name:'从这里分支',exact:true}).click();await page.getByLabel('新分支名称',{exact:true}).fill('另一条可核验的时间线');await page.getByRole('button',{name:'创建分支',exact:true}).click();await expect(dialog).toBeHidden();
 const branchB=await page.getByLabel('当前分支',{exact:true}).inputValue();assert.notEqual(branchB,main);
 s=await snapshot(page,w,branchB,true);assert.equal(s.scenes.length,1);assert.equal(s.state.variables.courage,undefined);assert.equal(s.state.inventory.length,0);
 await page.getByLabel('接下来，你想做什么？').fill('前往分支专属庭院');await page.getByRole('button',{name:/发送并继续/}).click();await expect(page.locator('#draftText')).toContainText(/你沿/);
 await page.getByLabel('当前分支',{exact:true}).selectOption(main);await expect(page.getByLabel('当前分支',{exact:true})).toHaveValue(main);await expect(page.locator('#draftCard')).toBeHidden();
 await expect.poll(async()=> (await snapshot(page,w,branchB,true)).scenes.length,{timeout:15000}).toBe(2);await expect(page.locator('#runBar')).toBeHidden();
 await expect(page.getByLabel('当前分支',{exact:true})).toHaveValue(main);await expect(page.locator('#sceneList')).not.toContainText('分支专属庭院');assert.deepEqual((await snapshot(page,w,main,true)).state,mainTruth.state);
 await page.getByLabel('当前分支',{exact:true}).selectOption(branchB);await expect(page.locator('#sceneList')).toContainText('分支专属庭院');await page.getByLabel('当前分支',{exact:true}).selectOption(main);
 f.mark('historical fork and stale SSE protection','Fork inherited exactly one historical scene. A fork turn finished after navigation to main; main UI stayed on main without fork narrative/state');
 // Back up through the browser download control, then restore to a new directory and restart.
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'备份全部存档',exact:true}).click();const download=await downloadPromise;const backupFile=join(f.temp,'browser-download.story-backup.json');await download.saveAs(backupFile);const backup=JSON.parse(await readFile(backupFile,'utf8'));assert.equal(backup.format,'story-runtime-backup');assert.ok(backup.files.some(x=>x.path==='world.sqlite'));
 const restoredDir=join(f.temp,'restored');await restoreBackup(backupFile,restoredDir);await f.restart(restoredDir);await page.locator(`#worldList [data-world-id="${w}"]`).click();await expect(page.locator('#worldTitle')).toHaveText('钟楼镇 · 我的故事');await page.getByLabel('作者视图',{exact:true}).check();await page.getByLabel('当前分支',{exact:true}).selectOption(main);
 const restored=await snapshot(page,w,main,true);assert.deepEqual(restored.state,mainTruth.state);assert.deepEqual(restored.scenes,mainTruth.scenes);assert.ok(restored.outbox.every(x=>x.status==='delivered'));
 await page.reload();await page.locator(`#worldList [data-world-id="${w}"]`).click();await expect(page.locator('#sceneList')).toContainText('前往钟楼');
 f.mark('browser backup and fresh-directory restore','Downloaded actual backup, restored to new data directory, started new server and verified prior story/state/branches and delivered DSH receipts');
 const recoveryState=f.server.store.snapshot(w,main);f.server.store.saveRun({worldId:w,branchId:main,runId:'browser-interrupted-draft',expectedHead:recoveryState.branch.head,sourceRevision:recoveryState.branch.sourceRevision,userText:'点亮已保存的信标',mode:'demo',status:'draft',draft:'你点亮了此前保存在草稿中的信标。',operations:[{op:'set_variable',key:'recoveredBeacon',value:true}],error:null});await f.restart(restoredDir);await page.locator(`#worldList [data-world-id="${w}"]`).click();await expect(page.locator('#runHistory')).toContainText('重启后已暂停');await page.locator('#runHistory summary').filter({hasText:'重启后已暂停'}).click();await page.getByRole('button',{name:'仅重试结算 · 不调用模型',exact:true}).click();await expect(page.locator('#sceneList')).toContainText('此前保存在草稿中的信标');const settled=await snapshot(page,w,main,true);assert.equal(settled.state.variables.recoveredBeacon,true);assert.equal(settled.usage.length,recoveryState.usage.length);f.mark('saved draft recovery','New server startup exposes interrupted draft; the explicit UI settlement button commits without another model call');

 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'世界',exact:true}).click();await saveScreenshot(page,'mobile-restored-world');
 const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(widths.scroll<=widths.viewport+1,`mobile horizontal overflow: ${JSON.stringify(widths)}`);
 await page.getByLabel('接下来，你想做什么？').fill('移动端读写验证');await page.getByRole('button',{name:/发送并继续/}).click();await expect(page.locator('#runBar')).toBeVisible();await expect(page.locator('#runBar')).toBeHidden({timeout:15000});await expect(page.locator('#sceneList')).toContainText('移动端读写验证');await saveScreenshot(page,'mobile-committed-story');
 f.mark('mobile layout and composer','390px viewport has no horizontal overflow and submits a real committed local demo turn');
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('tab',{name:'记录',exact:true}).click();await saveScreenshot(page,'desktop-restored-story');

});
