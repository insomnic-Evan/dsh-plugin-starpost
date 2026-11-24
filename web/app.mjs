import {sections} from './fields.mjs';
const $ = id=>document.getElementById(id);
function el(tag,text,cls) {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(cls) node.className=cls;
  return node;
}
const labels={account:'账号与会话',...Object.fromEntries(Object.entries(sections).map(([id,s])=>[id,s.title])),connection:'服务连接'};
const icons={account:'M20 21v-2a7 7 0 0 0-14 0v2 M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',notify:'M3 5h18v13H9l-5 4v-4H3z M7 9h10 M7 13h6',limits:'M3 6h18 M3 12h18 M3 18h18 M9 3v6 M16 9v6 M8 15v6',media:'M3 4h18v16H3z M4 17l6-6 4 4 3-3 4 4 M15 8h2',speech:'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8'};
let tab='account',state,nickname='',profileId='',dirty=false,busy=false;
icons.connection='M9 15l6-6 M8 13l-2 2a3 3 0 0 0 4 4l3-3 M11 8l3-3a3 3 0 0 1 5 4l-3 3';
function say(text,failed=false){$('notice').textContent=text;$('notice').className=failed?'error':'';}
async function api(action,body) {
  const headers={'X-Starpost-Panel':'1'};
  const opts={headers,cache:'no-store',credentials:'same-origin'};
  if(body!==undefined){headers['Content-Type']='application/json';opts.method='POST';opts.body=JSON.stringify(body);}
  const res=await fetch('./api/'+action,opts);
  const json=await res.json();
  if(!res.ok)throw Error(json.error || '请求失败');
  return json;
}
function btn(label,handler,primary=false) {
  const b=el('button',label,primary?'primary':'');b.type='button';b.addEventListener('click',handler);return b;
}
function group(cls='actions'){return el('div',undefined,cls);}
function card(title,cls='') {
  const c=el('section',undefined,'card '+cls);
  if(title)c.append(el('h2',title));
  return c;
}
function field(label,input) {
  const f=el('label',undefined,'field');f.append(el('span',label),input);return f;
}
function setBusy(value){busy=value;$('page').inert=value;$('tabs').inert=value;$('reload').disabled=value;}
async function action(fn) {
  if(busy)return;
  setBusy(true);
  try {await fn();} catch(e){say(e.message,true);} finally {setBusy(false);}
}
function resetAllowed(){return !dirty || window.confirm('放弃本页尚未保存的修改？');}
const baseline=()=>state.pendingRestart?'有设置待生效，重启 DSH 后将使用已保存的配置。':'已读取本机配置。';
async function refresh(message) {
  const next=await api('state');
  if(next.account.botId!==state?.account.botId)nickname='';
  state=next;dirty=false;render();say(message || baseline());
  if(state.account.botId && profileId!==state.account.botId){
    const id=state.account.botId;profileId=id;
    api('profile',{}).then(result=>{
      if(state.account.botId!==id)return;
      nickname=result.nickname;
      const title=$('accountName');if(title && nickname)title.textContent=nickname;
    }).catch(()=>{ /* The retry button remains available when the relay is offline. */ });
  }
}
async function save(data) {
  await api('save',{...data,revision:state.revision});
  await refresh('已保存。');
  say('已保存。'+(state.pendingRestart?'重启 DSH 后生效。':''));
}
function edit(){dirty=true;say('有尚未保存的修改。');}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
for(const [id,title] of Object.entries(labels)){
  const b=btn(title,()=>{if(!state || id===tab || !resetAllowed())return;tab=id;dirty=false;render();say(baseline());});
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(svg.namespaceURI,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('aria-hidden','true');p.setAttribute('d',icons[id]);svg.append(p);b.prepend(svg);b.dataset.tab=id;$('tabs').append(b);
}
$('reload').onclick=()=>action(async()=>{if(resetAllowed())await refresh();});
function display(f,v){return f.choices?.find(x=>x[0]===v)?.[1] ?? (f.type==='checkbox'?(v?'开启':'关闭'):String(f.scale?v/f.scale:v || '默认'));}
function accountPage() {
  const {account:a}=state, hero=card(a.registered?(nickname || '已登录的 bot'):'尚未登录星邮','hero');
  hero.querySelector('h2').id='accountName';
  const status=el('p',a.registered?'星邮 ID '+a.botId+' · '+(a.mode==='hub'?'FFA Hub 配对':'本机凭据登录'):'选择 DSH 会话后，使用 FFA Hub 在浏览器中配对。');hero.append(status);
  hero.append(el('div',state.ready?'已连接到 DSH 会话':a.expired?'Hub 授权已到期':state.runtimeSession?'等待会话就绪':'尚未启用接收','badge'));
  if(state.runtimeError)hero.append(el('p',state.runtimeError,'aux'));
  if(a.registered)hero.append(btn('读取 bot 昵称',()=>action(async()=>{nickname=(await api('profile',{})).nickname;hero.querySelector('h2').textContent=nickname || '已登录的 bot';say(nickname?'已读取昵称。':'该 bot 尚未设置昵称。');})));
  if(a.registered){
    const output=el('output');let shown=0;
    hero.append(btn('绑定凭据 · 显示并复制',()=>action(async()=>{
      const value=await api('bindingCredential',{});
      if(!hero.isConnected || state.account.botId!==value.botId)return;
      output.textContent=value.credential;
      const generation=++shown;
      setTimeout(()=>{if(shown===generation)output.textContent='';},60_000);
      let message='已复制';
      try {await navigator.clipboard.writeText(value.credential);} catch {message='请手动复制显示的凭据';}
      say(message+(value.expiresAt?' · 十分钟内有效，仅可使用一次':' · 原星邮账号凭据'));
    }),true),output);
  }
  const bind=card('DSH 会话'), select=el('select');
  select.append(new Option('选择一个会话',''));
  for(const s of state.sessions)select.append(new Option(s.title?s.title+' · '+s.id:s.id,s.id));
  select.value=state.sessionId;select.onchange=edit;
  bind.append(field('用于收发消息的会话',select));
  if(!state.sessions.length)bind.append(el('p','请先在 DSH 中创建一个会话，然后点击重新载入。'));
  const controls=group(), saveSession=btn('保存会话',()=>action(async()=>{if(!select.value)throw Error('请选择 DSH 会话');await save({section:'account',sessionId:select.value});}),true);
  controls.append(saveSession);bind.append(controls);
  if(state.runtimeSession)bind.append(el('p','本次启动使用的会话 · '+state.runtimeSession,'aux'));
  const auth=card('FFA Hub 登录'), pending=a.pending;
  function command(op,body={},ok='操作完成。'){
    return ()=>action(async()=>{
      if(dirty)throw Error('请先保存会话，或重新载入以放弃改动。');
      const result=await api(op,body);
      const messages={pending:'浏览器授权尚未完成。',awaiting_primary:'请管理员在 Hub 指定本安装为主运行端，再检查授权。',connected:'Hub 配对成功。'};
      await refresh((messages[result.status] || ok)+(result.status==='connected' || op==='login' || op==='register'?' 重启 DSH 后启用收发。':''));
    });
  }
  if(pending){
    const expired=Date.now()>=pending.expiresAt;
    auth.append(el('p',expired?'本次配对已过期，请重新开始。':'在 Hub 中选择要连接的 bot，并核对配对码。'));
    if(!expired){
      auth.append(el('div',pending.shortCode,'code'));
      const uri=new URL(pending.verificationUri);
      if(uri.protocol==='https:' || (uri.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(uri.hostname))){
        const link=el('a','打开 FFA Hub ↗','action primary');link.href=uri.href;link.target='_blank';link.rel='noopener noreferrer';auth.append(link);
      }
    }
    const buttons=group();
    buttons.append(expired?btn('重新配对',command('hubBegin',{},'已生成新的配对码。')):btn('检查授权并完成登录',command('hubFinish')),btn('取消配对',command('hubCancel',{},'已取消配对。')));auth.append(buttons);
  } else {
    auth.append(btn(a.mode==='hub'?'重新配对':'开始浏览器配对',command('hubBegin',{},'配对码已生成，请打开 FFA Hub。'),true));
  }
  const nodes=[hero,bind,auth];
  if(!a.registered){
    const box=el('details',undefined,'card');box.append(el('summary','使用原星邮凭据或注册新 bot'));
    const file=el('input');file.type='file';file.accept='.json,application/json';
    const controls=group();
    controls.append(btn('恢复已有账号',()=>action(async()=>{
      if(dirty || !state.sessionId)throw Error('请先保存 DSH 会话');
      const chosen=file.files[0];if(!chosen || chosen.size>8192)throw Error('请选择星邮凭据 JSON 文件（最大 8 KB）');
      let data;try{data=JSON.parse((await chosen.text()).replace(/^\uFEFF/,''));}catch{throw Error('凭据文件格式无效');}
      await api('login',{credential:data});file.value='';await refresh('账号已恢复，重启 DSH 后启用收发。');
    })),btn('注册新 bot',()=>{if(confirm('为此安装创建一个新的星邮 bot 账号？'))command('register',{confirm:true},'已注册新 bot。')();}));
    box.append(field('本机星邮凭据文件',file),controls);nodes.push(box);
  }
  return nodes;
}
function settingsPage(){
  const section=sections[tab], box=card();
  box.append(el('p',section.hint));
  const form=el('form'),grid=group('grid'),inputs=new Map();
  for(const f of section.fields){
    let input;
    if(f.type==='select'){input=el('select');for(const [v,l] of f.choices)input.append(new Option(l,v));}
    else {input=el('input');input.type=f.type;if(f.type==='number'){input.min=f.min/f.scale;input.max=f.max/f.scale;input.step=f.step==='any'?'any':1/f.scale;input.required=true;}else if(f.type==='text')input.maxLength=2048;}
    const saved=state.saved[f.key];if(f.type==='checkbox')input.checked=saved;else input.value=f.scale?saved/f.scale:saved;
    input.name=f.key;input.oninput=edit;const label=field(f.label,input);
    if(f.hint)label.append(el('small',f.hint));
    if(state.masked.includes(f.key))label.append(el('small','已隐藏原地址。填写新地址可替换原值。'));
    if(state.active[f.key]!==saved)label.append(el('small','本次启动 · '+display(f,state.active[f.key]),'pending'));
    inputs.set(f,input);grid.append(label);
  }
  const foot=group('formFoot'),submit=el('button','保存设置','primary');submit.type='submit';
  foot.append(submit,el('span','修改后重启 DSH 生效','aux'));form.append(grid,foot);
  form.onsubmit=e=>{e.preventDefault();action(async()=>{
    const values={};for(const [f,input] of inputs){let v=input.value;if(f.type==='number'){v=Number(v)*f.scale;if(f.step!=='any')v=Math.round(v);}if(f.type==='checkbox')v=input.checked;if(v!==state.saved[f.key])values[f.key]=v;}
    if(!Object.keys(values).length){dirty=false;say('设置没有改动。');return;}
    await save({section:tab,values});
  });};
  box.append(form);return [box];
}
function connectionPage() {
  const c=state.connection,box=card('中转与身份认证'),form=el('form'),grid=group('grid'),inputs={};
  box.append(el('p',c.locked?'当前账号数据已绑定以下服务。':'官方地址已预填。使用自建服务时，请在注册或配对前保存地址。'));
  for(const [key,label] of [['serverUrl','星邮中转服务'],['hubUrl','FFA Hub 账号中心']]){
    const input=el('input');input.type='url';input.required=true;input.value=c[key];input.readOnly=c.locked;input.oninput=edit;
    inputs[key]=input;grid.append(field(label,input));
  }
  form.append(grid);
  if(!c.locked){
    const foot=group('formFoot'),b=el('button','保存服务地址','primary');b.type='submit';foot.append(b);form.append(foot);
  }
  form.onsubmit=e=>{e.preventDefault();action(()=>save({section:'connection',serverUrl:inputs.serverUrl.value,hubUrl:inputs.hubUrl.value}));};
  box.append(form);return [box];
}
function render(){
  for(const b of $('tabs').children){if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  $('version').textContent='v'+state.pluginVersion;$('title').textContent=labels[tab];
  $('page').replaceChildren(...(tab==='account'?accountPage():tab==='connection'?connectionPage():settingsPage()));
}
action(()=>refresh());
