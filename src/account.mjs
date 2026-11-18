#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { clientHome, clientVersions, loadSettings, options, validateSettings, saveSettings, makeWorld, lock, pinServer } from './local.mjs';
const usage = 'starpost-dsh hub-login --session 会话ID | hub-complete | hub-cancel | register --session 会话ID | login --session 会话ID --file 凭据JSON文件 | configure [--session 会话ID] [--mode active|mixed|passive] [--square-mode manual|digest|realtime] [--feed-mode manual|digest|realtime] [--digest-interval-ms 300000] | status';
try {
  const [action, ...args] = process.argv.slice(2);
  const {values} = parseArgs({args,options:Object.fromEntries(['session','file','mode','server','hub','emoji-dir','square-mode','feed-mode','digest-interval-ms'].map(k=>[k,{type:'string'}]))});
  if (!action || action === '--help') { console.log(usage); }
  else {
    if (!['register','login','configure','status','hub-login','hub-complete','hub-cancel'].includes(action)) throw Error(usage);
    const dir = clientHome();
    const release = action === 'status' ? () => {} : lock(dir);
    try {
      const settings = loadSettings(dir);
      for (const [flag, key] of [['session','sessionId'],['mode','receiveMode'],['server','serverUrl'],['hub','hubUrl'],['emoji-dir','emojiDir'],['square-mode','squareMode'],['feed-mode','feedMode']])
        if (values[flag] !== undefined) settings[key] = values[flag];
      if (values['digest-interval-ms'] !== undefined) {
        if (!/^\d+$/.test(values['digest-interval-ms'])) throw Error('汇总间隔须为整数毫秒');
        settings.digestIntervalMs = Number(values['digest-interval-ms']);
      }
      if (action !== 'status') validateSettings(dir,settings);
      const world = makeWorld(dir,settings), invoke = world.webUi().invoke;
      let pairing;
      if (action === 'hub-login') {
        pinServer(dir,settings);
        pairing = await invoke('viewer','hubBegin',['星邮 DSH · '+settings.sessionId.slice(0,50)]);
      }
      if (action === 'hub-complete') pairing = await invoke('viewer','hubFinish',[]);
      if (action === 'hub-cancel') pairing = await invoke('viewer','hubCancel',[]);
      if (action === 'register' || action === 'login') {
        pinServer(dir,settings);
        if (action === 'register') await invoke('viewer','register',[]);
        else {
          if (!values.file) throw Error('请通过 --file 指定本机星邮凭据 JSON 文件');
          const data = readFileSync(values.file,'utf8').replace(/^\uFEFF/,'');
          await invoke('viewer','login',[JSON.parse(data).botId,data]);
        }
      }
      if (action !== 'status') saveSettings(dir,settings);
      console.log(JSON.stringify({ ...await invoke('viewer','status',[]), hub:await invoke('viewer','hubStatus',[]), ...(pairing ? {pairing} : {}), ...clientVersions, sessionId:settings.sessionId ?? null,
        receiveMode:options(settings,dir).receiveMode, notifications:options(settings,dir).notifications,
        settingsSource:'client.json（DSH 设置面板中的显式设置优先；修改后重启 Harness）', directory:dir, credentialFile:join(dir,'starpost-credential.json') }, null, 2));
    } finally { release(); }
  }
} catch (error) { console.error(error instanceof SyntaxError ? '配置或凭据文件不是有效的 JSON' : error.message); process.exitCode = 1; }
