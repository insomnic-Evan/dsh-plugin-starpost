import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { options, makeWorld } from '../src/local.mjs';

test('DSH speech settings reject commands disguised as keys and unsupported options',()=>{
  assert.throws(()=>options({speech:{asrKeySecret:'secret value; cmd'}},tmpdir()));
  assert.throws(()=>options({speech:{command:'run this'}},tmpdir()));
  assert.throws(()=>options({speech:{ttsProtocol:'shell'}},tmpdir()));
  assert.equal(options({speech:{audioDir:'audio',asrProtocol:'json'}},tmpdir()).speech.asrProtocol,'json');
});
test('DSH bundled client sends TTS and receives ASR through the owner channel',{skip:!process.env.STARPOST_VOICE_TEST_SERVER},async()=>{
  const {createStarpostServer}=await import(pathToFileURL(process.env.STARPOST_VOICE_TEST_SERVER));
  const dir=mkdtempSync(join(tmpdir(),'dsh-voice-')),key='x'.repeat(32);let calls=0;
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  const audio={mime:'audio/wav',base64:wav.toString('base64'),durationMs:1000};
  const provider=createServer(async(req,res)=>{for await(const _ of req){}assert.equal(req.headers.authorization,'Bearer test-speech-key');calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/tts'?{audio}:{text:'来自用户的隔离语音'}))});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const relay=createStarpostServer({file:join(dir,'relay.json'),keys:{10001:key},port:0});await relay.listen();
  const serverUrl=`http://127.0.0.1:${relay.server.address().port}`,speechUrl=`http://127.0.0.1:${provider.address().port}`;
  const botdir=join(dir,'client');mkdirSync(botdir);writeFileSync(join(botdir,'starpost-credential.json'),JSON.stringify({version:1,botId:'10001',token:key}));
  const old=process.env.STARPOST_VOICE_TEST_KEY;process.env.STARPOST_VOICE_TEST_KEY='test-speech-key';
  const world=makeWorld(botdir,{serverUrl,speech:{asrUrl:speechUrl+'/asr',asrProtocol:'json',asrKeySecret:'STARPOST_VOICE_TEST_KEY',ttsUrl:speechUrl+'/tts',ttsProtocol:'json',ttsKeySecret:'STARPOST_VOICE_TEST_KEY'}}),events=[];
  const post=async(path,body,token)=>{const r=await fetch(serverUrl+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});const v=await r.json();assert.ok(v.ok,v.error);return v.result};
  try{
    await world.start({pushEvent:async(e,o)=>{events.push({e,o});return{cursor:events.length}},promotePending:async()=>true});
    const login=await post('/mobile/login',{botId:'10001',credential:key});await post('/mobile/rpc',{action:'owner.address',args:{address:'主人'}},login.accessToken);
    await post('/mobile/rpc',{action:'owner.send',args:{audio}},login.accessToken);await world.poll();
    const received=events.find(x=>x.e.type==='starpost.owner_message');assert.match(received.e.text,/来自用户的隔离语音/);assert.equal(received.o.trigger,'flush');
    const result=await world.tools()[0].handler({family:'mobile',action:'send',argsJson:JSON.stringify({speechText:'你好'})},{});assert.ok(!result.failed,JSON.stringify(result));
    const history=await post('/mobile/rpc',{action:'owner.history',args:{}},login.accessToken);assert.ok(history.messages.some(m=>m.direction==='bot'&&m.audio?.mediaId));assert.equal(calls,2);
  }finally{await world.stop();await relay.close();await new Promise(r=>provider.close(r));if(old===undefined)delete process.env.STARPOST_VOICE_TEST_KEY;else process.env.STARPOST_VOICE_TEST_KEY=old;rmSync(dir,{recursive:true,force:true})}
});
