import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createStarpostServer } from 'cortico-world-starpost/server/server.mjs';
import * as plugin from '../src/index.mjs';
import { makePanel, panelPath } from '../src/panel.mjs';
import { makeWorld, options, loadSettings } from '../src/local.mjs';

test('first-use file configuration, stale writes, alternate account recovery, and actual Hub pairing protocol',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'starpost-panel-file-'));
  const access='A'.repeat(64), polling='P'.repeat(64), legacy='k'.repeat(32);
  let hubOrigin, approved=false, primary=false, paired;
  const hub=createServer(async(req,res)=>{
    const chunks=[]; for await(const c of req)chunks.push(c);
    const data=JSON.parse(Buffer.concat(chunks));
    const replies={
      '/hub/info':()=>({issuer:hubOrigin,service:'starpost'}),
      '/v1/pairings':()=>{paired=data;return {pairingId:'P1',pollingSecret:polling,shortCode:'1234',challenge:'fake-challenge',verificationUri:hubOrigin+'/?pair=P1'};},
      '/v1/pairings/prove':()=>({ok:true}),
      '/v1/pairings/poll':()=>approved?{status:'approved',issuer:hubOrigin,audience:'starpost',installationId:paired.installationId,accessToken:access,subject:'bot-subject'}:{status:'pending'},
      '/hub/connect':()=>({issuer:hubOrigin,botId:'10001',subject:'bot-subject',isPrimary:primary,expiresAt:Date.now()+86400000}),
      '/login':()=>({botId:'10001'}),
    };
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ok:true,result:replies[req.url]?.()}));
  });
  await new Promise(r=>hub.listen(0,'127.0.0.1',r)); hubOrigin='http://127.0.0.1:'+hub.address().port;
  t.after(async()=>{await new Promise(r=>hub.close(r));rmSync(dir,{recursive:true,force:true});});
  writeFileSync(join(dir,'client.json'),JSON.stringify({serverUrl:hubOrigin,hubUrl:hubOrigin,preserve:'existing',speech:{asrUrl:'https://example.org/asr?api_key=previous-secret'}}));
  const startup=options(loadSettings(dir),dir);
  const run=makePanel({dir,sessions:()=>[{id:'alpha',title:'测试会话'}],runtime:()=>({cfg:startup}),nativeSettings:()=>undefined,withWorld:fn=>fn(makeWorld(dir,loadSettings(dir)))});
  const initial=await run('state');
  assert.ok(!JSON.stringify(initial).includes('previous-secret'));assert.deepEqual(initial.masked,['speech.asrUrl']);
  await run('save',{section:'connection',serverUrl:hubOrigin,hubUrl:hubOrigin,revision:initial.revision});
  await run('save',{section:'notify',values:{squareMode:'manual'},revision:initial.revision});
  await assert.rejects(run('save',{section:'account',sessionId:'alpha',revision:initial.revision}),/其他页面/);
  let s=await run('state');
  assert.equal(s.saved.squareMode,'manual');assert.equal(s.active.squareMode,'digest');assert.equal(s.pendingRestart,true);
  await assert.rejects(run('save',{section:'notify',values:{serverUrl:'https://example.com'},revision:s.revision}),/无效/);
  await run('save',{section:'account',sessionId:'alpha',revision:s.revision});
  await run('login',{credential:{version:1,botId:'10001',token:legacy}});
  assert.equal((await run('bindingCredential')).credential,legacy);
  assert.ok(!JSON.stringify(await run('state')).includes(legacy));
  await assert.rejects(run('register',{confirm:true}),/已有/);
  await run('hubBegin');s=await run('state');
  assert.equal(s.account.pending.shortCode,'1234');assert.ok(!JSON.stringify(s).includes(polling));
  await run('hubCancel');assert.equal((await run('state')).account.pending,null);
  await run('hubBegin');assert.equal((await run('hubFinish')).status,'pending');
  approved=true;assert.equal((await run('hubFinish')).status,'awaiting_primary');
  primary=true;assert.equal((await run('hubFinish')).status,'connected');
  s=await run('state');assert.equal(s.account.botId,'10001');assert.equal(s.account.mode,'hub');
  await assert.rejects(run('save',{section:'connection',serverUrl:'https://example.org',hubUrl:hubOrigin,revision:s.revision}),/已绑定/);
  for(const secret of [polling,access,legacy])assert.ok(!JSON.stringify(s).includes(secret));
  assert.equal(loadSettings(dir).preserve,'existing');
});

test('official DSH web gateway and settings store save, persist across remount, and serve the browser', {skip:!process.env.DSH_SETTINGS_TEST_MODULES,timeout:60000},async t=>{
  const require=createRequire(join(resolve(process.env.DSH_SETTINGS_TEST_MODULES),'../package.json'));
  const load=name=>import(pathToFileURL(require.resolve('@deepseek-ai/'+name)));
  const [{Context},{default:WebServer},{default:FileSettings}]=await Promise.all([load('cordis'),load('dsh-host-webserver'),load('dsh-settings-file')]);
  const dir=mkdtempSync(join(tmpdir(),'starpost-panel-host-')), prior=process.env.STARPOST_DSH_HOME;
  process.env.STARPOST_DSH_HOME=dir;
  const ctx=new Context();
  const relay=createStarpostServer({file:join(dir,'relay.json'),port:0});
  await relay.listen();
  t.after(async()=>{await ctx.fiber.dispose();await relay.close();if(prior===undefined)delete process.env.STARPOST_DSH_HOME;else process.env.STARPOST_DSH_HOME=prior;rmSync(dir,{recursive:true,force:true});});
  writeFileSync(join(dir,'client.json'),JSON.stringify({serverUrl:'http://127.0.0.1:'+relay.server.address().port}));
  ctx.provide('agents',{list:()=>[]});ctx.provide('tools',{register:()=>()=>{}});
  ctx.provide('sessionPersistence',{list:async()=>[{id:'chosen-session',title:'本机测试会话'}]});
  await ctx.plugin(FileSettings,{path:join(dir,'native.json'),watch:false});
  await ctx.plugin(WebServer,{host:'127.0.0.1',port:0});
  let fork=ctx.plugin(plugin);await fork;
  const origin='http://127.0.0.1:'+ctx.webServer.port;
  const base=origin+panelPath+'/';
  const get=async()=>{const res=await fetch(base+'api/state',{headers:{'x-starpost-panel':'1'}});assert.equal(res.status,200);return res.json();};
  const post=(action,body,extra={})=>fetch(base+'api/'+action,{method:'POST',headers:{origin,'x-starpost-panel':'1','content-type':'application/json',...extra},body:JSON.stringify(body)});
  const start=await get();assert.ok(start.native);assert.equal(start.sessions[0].id,'chosen-session');
  assert.equal((await fetch(base+'api/state')).status,403);
  assert.equal((await post('save',{}, {origin:'https://example.com'})).status,403);
  assert.equal((await post('save',{}, {'x-forwarded-for':'203.0.113.1'})).status,403);
  assert.equal((await post('save',{section:'notify',values:{feedMode:'manual'},revision:start.revision})).status,200);
  assert.equal(loadSettings(dir).feedMode,undefined);
  assert.equal((await get()).saved.feedMode,'manual');assert.notEqual((await get()).active.feedMode,'manual');
  await fork.dispose();assert.equal((await fetch(base)).status,404);
  fork=ctx.plugin(plugin);await fork;
  assert.equal((await get()).active.feedMode,'manual');
  if(process.env.STARPOST_PANEL_PLAYWRIGHT){
    const {chromium}=createRequire(import.meta.url)(process.env.STARPOST_PANEL_PLAYWRIGHT);
    const browser=await chromium.launch({channel:'msedge'});t.after(()=>browser.close());
    const page=await browser.newPage({viewport:{width:1030,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.getByLabel('用于收发消息的会话').selectOption('chosen-session');
    await page.getByRole('button',{name:'保存会话'}).click();
    await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('已保存'));
    await page.locator('summary').click();page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'注册新 bot'}).click();
    await page.getByText(/星邮 ID 10001/).waitFor();
    await page.getByRole('button',{name:'消息接收',exact:true}).click();
    await page.getByLabel('广场与公开开桌').selectOption('manual');
    await page.getByRole('button',{name:'保存设置'}).click();
    await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('已保存'));
    await page.getByRole('button',{name:'额度与防刷',exact:true}).click();
    await page.getByLabel('静默收尾（秒）').fill('86400');
    await page.getByRole('button',{name:'保存设置'}).click();
    await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('已保存'));
    assert.equal(loadSettings(dir).antiLoop.idleToEndSec,86400);
    await page.setViewportSize({width:390,height:760});await page.emulateMedia({colorScheme:'dark'});
    await page.getByRole('button',{name:'语音与转换',exact:true}).click();
    await page.getByLabel('音色',{exact:true}).fill('nova');await page.getByRole('button',{name:'保存设置'}).click();
    await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('已保存'));
    assert.equal(loadSettings(dir).speech.ttsVoice,'nova');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'表情包',exact:true}).click();await page.getByLabel('自动收藏收到的表情包').uncheck();
    await page.getByRole('button',{name:'保存设置'}).click();await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('已保存'));
    assert.equal(loadSettings(dir).sticker.enabled,false);assert.deepEqual(errors,[]);
  }
});
