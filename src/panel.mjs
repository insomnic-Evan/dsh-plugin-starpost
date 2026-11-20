import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { clientVersions, loadSettings, options, pinServer, saveSettings } from './local.mjs';
import { settingsNamespace } from './settings.mjs';
import { sections, check, readKey, setKey } from '../web/fields.mjs';

export const panelPath = '/starpost/settings';
const assets = new Map([
  ['', ['index.html','text/html']], ['index.html',['index.html','text/html']],
  ['app.mjs',['app.mjs','text/javascript']], ['fields.mjs',['fields.mjs','text/javascript']], ['style.css',['style.css','text/css']]
]);
const error = (message, status = 400) => Object.assign(new Error(message), {status});
function project(cfg) {
  const flat = {...cfg, ...cfg.notifications};
  return Object.fromEntries(Object.values(sections).flatMap(section => section.fields.map(f => [f.key,readKey(flat,f.key)])));
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function loopback(host) { return ['127.0.0.1','localhost','[::1]'].includes(host); }
function serviceOrigin(value) {
  let url;
  try { url=new URL(value); } catch { throw error('服务地址无效'); }
  if (!(url.protocol==='https:' || url.protocol==='http:' && loopback(url.hostname)) ||
      url.username || url.password || url.search || url.hash || url.pathname!=='/') throw error('请输入 HTTPS 服务根地址，本机测试可使用 HTTP 回环地址');
  return url.origin;
}
function hasPrivateUrlParts(url) {
  return Boolean(url.username || url.password || url.hash || [...url.searchParams.keys()].some(key=>/token|secret|password|signature|api.?key|authorization|credential|^key$|^sig$/i.test(key)));
}
function forDisplay(values) {
  const clean={...values}, masked=[];
  for (const key of Object.keys(clean).filter(key=>key.endsWith('Url') && clean[key])) {
    try { if (!hasPrivateUrlParts(new URL(clean[key]))) continue; } catch {}
    masked.push(key); clean[key]='';
  }
  return {values:clean, masked};
}

export function makePanel({dir, sessions, runtime, nativeSettings, withWorld, entry = {}}) {
  async function config() {
    const file = loadSettings(dir), service = nativeSettings();
    const descriptor = service && (await service.describe()).find(d => d.ns === settingsNamespace);
    const resolved=options({...file,...entry,...descriptor?.user},dir);
    const saved=project(resolved);
    return {file, descriptor, service, saved, resolved, revision:digest([file, saved, descriptor?.revision ?? null])};
  }
  async function account(world) {
    const invoke = world.webUi().invoke;
    const [identity,hub] = await Promise.all([invoke('viewer','status',[]), invoke('viewer','hubStatus',[])]);
    const pending = hub.pending;
    return {botId:identity.botId, registered:identity.registered, mode:hub.mode, expired:Boolean(hub.expired),
      pending:pending ? {shortCode:pending.shortCode,verificationUri:pending.verificationUri,expiresAt:pending.expiresAt} : null};
  }
  async function state() {
    const cfg = await config(), running = runtime(), choices = await sessions();
    const sessionId = cfg.file.sessionId || '';
    if (sessionId && !choices.some(s=>s.id===sessionId)) choices.push({id:sessionId,title:'已保存的会话'});
    const active = project(running.cfg);
    const identity=await withWorld(account);
    const display=forDisplay(cfg.saved);
    const connection={serverUrl:cfg.resolved.serverUrl,hubUrl:serviceOrigin(cfg.resolved.hubUrl),
      locked:identity.registered || Boolean(identity.pending) || existsSync(join(dir,'server-origin'))};
    return { ...clientVersions, sessions:choices, sessionId, runtimeSession:running.sessionId || '',
      ready:running.ready, runtimeError:running.error, account:identity, connection,
      saved:display.values, masked:display.masked, active:forDisplay(active).values, revision:cfg.revision, native:Boolean(cfg.descriptor),
      pendingRestart:sessionId !== (running.sessionId || '') || Object.keys(active).some(key=>active[key] !== cfg.saved[key]) ||
        running.cfg.serverUrl!==cfg.resolved.serverUrl || running.cfg.hubUrl!==cfg.resolved.hubUrl };
  }
  async function perform(action, body) {
    if (action==='state') return state();
    if (action==='save') {
      // Share the runtime/CLI data-directory lock for the full read–validate–write.
      return withWorld(async world => {
        const cfg = await config();
        if (body.revision !== cfg.revision) throw error('设置已在其他页面修改，请重新载入后再保存。',409);
        if (body.section==='account') {
          const list = await sessions();
          if (!list.some(s=>s.id===body.sessionId) && (!cfg.file.sessionId || cfg.file.sessionId !== body.sessionId)) throw error('请选择当前 DSH 中的会话');
          saveSettings(dir,{...cfg.file,sessionId:body.sessionId});
          return {};
        }
        if (body.section==='connection') {
          const id=await account(world);
          if (id.registered || id.pending || existsSync(join(dir,'server-origin'))) throw error('该数据目录已绑定服务');
          saveSettings(dir,{...cfg.file,serverUrl:serviceOrigin(body.serverUrl),hubUrl:serviceOrigin(body.hubUrl)},{allowUnbound:true});
          return {};
        }
        if (!Object.hasOwn(sections,body.section) || !body.values || typeof body.values!=='object' || Array.isArray(body.values)) throw error('设置栏目无效');
        const fields=sections[body.section].fields, changes=Object.entries(body.values);
        if (!changes.length) return {};
        for (const [key,value] of changes) {
          const field=fields.find(f=>f.key===key);
          if (!field || !check(field,value)) throw error((field?.label ?? '配置项')+' 的值无效');
          if (key.endsWith('Url') && value) {
            let url;
            try { url = new URL(value); } catch { throw error(field.label+' 地址无效'); }
            if (!(url.protocol==='https:' || url.protocol==='http:' && loopback(url.hostname)) || hasPrivateUrlParts(url)) throw error(field.label+' 请使用 HTTPS 或本机 HTTP 地址，密钥请通过环境变量提供');
          }
          if (['speech.ffmpegPath','speech.silkPath'].includes(key) && value && !isAbsolute(value)) throw error(field.label+' 请填写绝对路径');
          setKey(cfg.file,key,value);
        }
        options(cfg.file,dir);
        if (body.section==='notify' && cfg.descriptor) {
          await cfg.service.update(settingsNamespace,body.values,cfg.descriptor.revision);
        } else {
          if (body.section==='notify' && changes.some(([key])=>Object.hasOwn(entry,key))) throw error('该项由 DSH 启动配置覆盖，请在宿主设置中修改。');
          saveSettings(dir,cfg.file,{allowUnbound:true});
        }
        return {};
      });
    }
    if (!['profile','hubBegin','hubFinish','hubCancel','register','login'].includes(action)) throw error('接口不存在',404);
    return withWorld(async world => {
      const invoke=world.webUi().invoke, before=await account(world);
      if (action==='profile') {
        if (!before.botId) throw error('请先登录星邮');
        const result=await invoke('viewer','profileRead',[before.botId,'basic']);
        return {nickname:String(result.nickname ?? '').slice(0,120)};
      }
      if (action==='hubCancel') { await invoke('viewer',action,[]); return {}; }
      const settings=loadSettings(dir);
      if (!settings.sessionId) throw error('请先选择并保存 DSH 会话');
      if (action==='hubFinish') {
        const result=await invoke('viewer',action,[]);
        return {status:result.status};
      }
      pinServer(dir,settings);
      if (action==='hubBegin') {
        if (before.pending && before.pending.expiresAt>Date.now()) throw error('已有配对等待确认，可继续或取消。');
        if (before.pending) await invoke('viewer','hubCancel',[]);
        await invoke('viewer',action,['星邮 DSH · '+settings.sessionId.slice(0,50)]);
      } else {
        if (before.registered) throw error('本机已有星邮账号');
        if (action==='register') {
          if (body.confirm!==true) throw error('请确认注册新账号');
          await invoke('viewer','register',[]);
        } else {
          const data=body.credential;
          if (!data || typeof data.botId!=='string' || typeof data.token!=='string') throw error('请选择包含 botId 和 token 的星邮凭据文件');
          await invoke('viewer','login',[data.botId,JSON.stringify({version:data.version,botId:data.botId,token:data.token})]);
        }
      }
      return {};
    });
  }
  let queue=Promise.resolve();
  return async (action,body={}) => {
    const task=queue.then(()=>perform(action,body));
    queue=task.catch(()=>{});
    return task;
  };
}

export function panelHandler(run) {
  return async (req,res) => {
    const json=(code,obj)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj));};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    try {
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
          !/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/i.test(req.headers.host || '') ||
          ['forwarded','x-forwarded-for','x-forwarded-host'].some(key=>req.headers[key])) throw error('请在运行 DSH 的本机打开设置',403);
      const origin=(req.socket.encrypted?'https://':'http://')+req.headers.host;
      const pathname=new URL(req.url,origin).pathname;
      if (pathname===panelPath) {res.writeHead(302,{location:panelPath+'/'});return res.end();}
      if (!pathname.startsWith(panelPath+'/')) throw error('页面不存在',404);
      const name=pathname.slice(panelPath.length+1);
      if (req.method==='GET' && assets.has(name)) {
        const [file,type]=assets.get(name);
        const bytes=readFileSync(new URL('../web/'+file,import.meta.url));
        res.writeHead(200,{'content-type':type+'; charset=utf-8'});return res.end(bytes);
      }
      if (!/^api\/[a-zA-Z]+$/.test(name)) throw error('页面不存在',404);
      const action=name.slice(4);
      if (req.headers['x-starpost-panel']!=='1' || (req.headers.origin && req.headers.origin!==origin)) throw error('请求来源无效',403);
      if (action==='state' && req.method==='GET') return json(200,await run(action));
      if (req.method!=='POST' || action==='state') throw error('请求方法无效',405);
      if (req.headers.origin!==origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw error('请求来源或格式无效',403);
      let size=0;const chunks=[];
      for await (const chunk of req) { size+=chunk.length;if(size>16384)throw error('请求过大',413);chunks.push(chunk); }
      let body;
      try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw error('无效的 JSON');}
      if (!body || typeof body!=='object' || Array.isArray(body)) throw error('请求格式无效');
      return json(200,await run(action,body));
    } catch (cause) {
      const msg=String(cause.message || '操作失败').replace(/\b[A-Za-z0-9_+./=-]{48,}\b/g,'[已隐藏]').slice(0,350);
      return json(Number.isInteger(cause.status) && cause.status>=400 && cause.status<=599 ? cause.status : 400,{error:msg});
    }
  };
}
