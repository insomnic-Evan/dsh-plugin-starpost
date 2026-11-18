import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { options } from '../src/local.mjs';
import { Config, registerNotificationSettings } from '../src/settings.mjs';
import { Context } from '@deepseek-ai/cordis';

test('notification config supports flat and nested client.json; validates instead of silently ignoring', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starpost-settings-'));
  try {
    assert.deepEqual(Config({}), {});
    for (const receiveMode of ['active', 'mixed', 'passive']) {
      const cfg = options({ receiveMode, squareMode:'manual', feedMode:'manual', digestIntervalMs:60000 }, dir);
      assert.deepEqual(cfg.notifications, { squareMode:'manual', feedMode:'manual', digestIntervalMs:60000 });
    }
    assert.equal(options({ notifications:{squareMode:'manual'} },dir).notifications.squareMode,'manual');
    assert.equal(options({ squareMode:'digest', notifications:{squareMode:'manual'} },dir).notifications.squareMode,'digest');
    for (const invalid of [{squareMode:'off'}, {feedMode:'bad'}, {digestIntervalMs:0}, {digestIntervalMs:86400001}, {digestIntervalMs:1.2}, {digestIntervalMs:'300000'}, {notifications:null}, {notifications:[]}, {notifications:{typo:'manual'}}]) {
      assert.throws(()=>options(invalid,dir));
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('CLI saves notification choices without replacing session, speech or credentials and rejects invalid input atomically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'starpost-settings-cli-'));
  try {
    const before = { sessionId:'existing-session', receiveMode:'active', speech:{asrModel:'keep-model'}, unknownFutureSetting:true };
    const settingsPath=join(dir,'client.json'); writeFileSync(settingsPath,JSON.stringify(before));
    const cli = args => promisify(execFile)(process.execPath, ['src/account.mjs',...args], { cwd:new URL('../',import.meta.url), env:{...process.env,STARPOST_DSH_HOME:dir} });
    const result = JSON.parse((await cli(['configure','--square-mode','manual','--feed-mode','manual','--digest-interval-ms','60000'])).stdout);
    assert.equal(result.sessionId,before.sessionId);
    assert.deepEqual(result.notifications,{squareMode:'manual',feedMode:'manual',digestIntervalMs:60000});
    const saved=readFileSync(settingsPath,'utf8');
    assert.equal(JSON.parse(saved).speech.asrModel,'keep-model');
    assert.equal(JSON.parse(saved).unknownFutureSetting,true);
    await assert.rejects(cli(['configure','--square-mode','off']));
    assert.equal(readFileSync(settingsPath,'utf8'),saved);
    await assert.rejects(cli(['configure','--digest-interval-ms','1.5']));
    assert.equal(readFileSync(settingsPath,'utf8'),saved);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('older Harness without settings service still reads client.json', async () => {
  const ctx=new Context();
  try {
    const base={receiveMode:'active',squareMode:'manual',feedMode:'digest',digestIntervalMs:60000};
    let get;
    await ctx.plugin({ apply(scoped) { get=registerNotificationSettings(scoped,base); } });
    assert.deepEqual(get(),base);
  } finally { await ctx.fiber.dispose(); }
});
