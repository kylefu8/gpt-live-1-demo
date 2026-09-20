import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve,sep,extname} from 'node:path';
import WebSocket from 'ws';
import {publicConfig,validateConfig,liveInstructions} from './config.mjs';
import {runBackend} from './backend.mjs';
import {fastTimeAnswer} from './fast-time.mjs';
import {SpeechDelivery} from './delivery.mjs';
import {createSettingsStore,mergeSettings,publicSettings,passwordHash} from './settings-store.mjs';
import {createAuth} from './auth.mjs';
import {probeVoice,probeBackend,voiceHeaders,backendConnection,friendlyApiError} from './connections.mjs';
import {requestLanguage,localizeResponse,translateMessage,backendPhase} from './ui-messages.mjs';

export async function startServer(options={}){
  try{process.loadEnvFile?.();}catch(error){if(error.code!=='ENOENT')throw new Error('无法读取 .env 配置文件');}
  let port=Number(options.port??process.env.PORT??8767);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('端口需要是 0–65535 的整数');
  const host=options.host||process.env.HOST||'127.0.0.1';
  const mode=options.mode||process.env.APP_MODE||'local';
  if(!['local','remote'].includes(mode))throw new Error('APP_MODE 只能是 local 或 remote');
  if(mode==='local'&&!['127.0.0.1','localhost','::1'].includes(host)&&process.env.ALLOW_LOCAL_NETWORK!=='1')throw new Error('本机模式只能监听回环地址。服务器部署请使用 remote 模式；本机 Docker 请使用提供的 compose 文件。');
  let origin=options.publicOrigin||process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'';
  if(mode==='remote'){
    let parsed;try{parsed=new URL(origin);}catch{throw new Error('服务器模式需要设置 PUBLIC_ORIGIN 为公开的 HTTPS 地址');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('PUBLIC_ORIGIN 需要是 HTTPS 域名根地址');
    origin=parsed.origin;
  }
  const store=await createSettingsStore(options.dataDir);
  const auth=createAuth({mode,store,setupToken:options.setupToken||process.env.SETUP_TOKEN});
  const probes={voice:options.probes?.voice||probeVoice,backend:options.probes?.backend||probeBackend};
  const verified=new Map();
  const sessions=new Map(),recentStatuses=new Map();
  let creating=false;
  function safeMessage(message){
    let value=String(message||'');const current=store.get();
    for(const secret of [current.voice.apiKey,current.backend.apiKey,auth.initialToken])if(secret)value=value.split(secret).join('[REDACTED]');
    return value.replace(/https?:\/\/\S+/g,'[service address]').slice(0,400);
  }
  const fingerprint=(kind,settings)=>createHash('sha256').update(JSON.stringify(kind==='voice'?settings.voice:{backend:settings.backend,reasoning:settings.preferences.reasoningEffort})).digest('hex');
  async function verify(kind,settings){
    const id=fingerprint(kind,settings);if(verified.get(id)>Date.now())return {ok:true,message:'连接验证通过'};
    try{const result=await probes[kind](kind==='voice'?settings.voice:settings);verified.set(id,Date.now()+5*60000);if(verified.size>32)verified.delete(verified.keys().next().value);return result;}
    catch(error){throw new Error(friendlyApiError(error,{kind}));}
  }

function reply(res,status,data){if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Language':res.uiLanguage||'zh-CN'});res.end(JSON.stringify(localizeResponse(data,res.uiLanguage)));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>100000)throw new Error('请求过大');}return JSON.parse(data);}
function statusOf(record){return {backendStatus:record.backendStatus,backendPhase:backendPhase(record),tools:record.tools.slice(-20),sources:record.sources.slice(-12),usage:record.usage,answers:record.delivery?.snapshot()||[],closed:record.closed};}
function send(record,event){if(record.closed||record.socket.readyState!==WebSocket.OPEN)return false;record.socket.send(JSON.stringify(event));return true;}
function rememberStatus(record){recentStatuses.set(record.id,statusOf(record));setTimeout(()=>recentStatuses.delete(record.id),120000).unref();}
function cleanup(record){
  if(record.closed)return;
  record.closed=true;record.abort.abort();record.delivery?.dispose();clearTimeout(record.expiry);clearTimeout(record.cleanupTimer);
  record.backendStatus=record.backendStatus==='正在回答'?'已结束':record.backendStatus;
  rememberStatus(record);sessions.delete(record.id);record.history.length=0;
}
function closeSession(id){
  const record=sessions.get(id);if(!record||record.closing)return;
  record.closing=true;record.abort.abort();clearTimeout(record.expiry);
  send(record,{type:'session.close',event_id:'local_close'});
  record.cleanupTimer=setTimeout(()=>{record.socket.terminate();cleanup(record);},5000);
}
function appendHistory(record,role,event){
  if(typeof event.delta!=='string'||!event.delta)return;
  const last=record.history.at(-1);
  if(last&&last.role===role&&Number(event.start_ms)-(last.endMs||0)<2500){last.text=(last.text+event.delta).slice(-6000);last.endMs=event.end_ms;}
  else record.history.push({role,text:event.delta.slice(0,6000),endMs:event.end_ms});
  if(record.history.length>100)record.history.shift();
  if(role==='user')record.lastInputAt=Date.now();
}
function addSources(record,rows){record.sources=[...new Map([...record.sources,...rows].filter(x=>x&&typeof x.url==='string').map(x=>[x.url,x])).values()].slice(-12);}
function addTool(record,event){record.tools.push({...event,at:new Date().toISOString()});if(record.tools.length>40)record.tools.shift();}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function handleDelegation(record,id,contextVersion){
  if(record.closing||record.closed)return;
  // Let timed transcript fragments catch up to the delegation metadata.
  const settleUntil=Date.now()+1400;
  await delay(400);
  while(Date.now()<settleUntil&&Date.now()-record.lastInputAt<300)await delay(150);
  if(record.closing||record.closed||contextVersion!==record.taskVersion)return;
  record.backendStatus='正在处理';
  try{
    const fast=await fastTimeAnswer(record.history,record.config);
    let answer;
    if(fast){
      addTool(record,{name:'get_current_time',status:'completed',summary:'已直接读取本机时间，未调用推理模型'});
      answer=fast.text;
    }else if(!record.backend)answer='推理后端尚未配置。你可以先语音聊天或查询时间，在连接设置中添加推理服务后即可使用复杂问答和联网工具。';
    else answer=await runBackend({backend:record.backend,config:record.config,history:record.history,
      signal:AbortSignal.any([record.abort.signal,AbortSignal.timeout(75000)]),
      onStatus:status=>{record.backendStatus=status;},onTool:event=>addTool(record,event),onSources:rows=>addSources(record,rows),
      onUsage:usage=>{record.usage.backendInputTokens+=(usage.input_tokens||0);record.usage.backendOutputTokens+=(usage.output_tokens||0);}
    });
    if(record.closing||record.closed||contextVersion!==record.taskVersion)return;
    record.delivery.enqueue(answer,id,contextVersion,{immediateSpeak:Boolean(fast)});
  }catch(error){
    if(record.closing||record.closed)return;
    const message=safeMessage(error.name==='TimeoutError'?'后端处理超时，请缩小问题后再试':error.message);
    record.backendStatus=`后端失败：${message}`;
    addTool(record,{name:'backend',status:'failed',summary:message});
    record.delivery.enqueue(`本次后端处理失败：${message.slice(0,150)}。请稍后再试。`,id,contextVersion);
  }
}
async function attach(id,config,backend,voice){
  const socket=new WebSocket(`${voice.baseUrl.replace('https:','wss:')}/live/sessions/${encodeURIComponent(id)}/attach`,{headers:voiceHeaders(voice),handshakeTimeout:10000,followRedirects:false});
  const record={id,socket,config,backend,closed:false,closing:false,history:[],lastInputAt:0,taskVersion:0,seen:new Set(),queue:Promise.resolve(),abort:new AbortController(),backendStatus:'就绪',tools:[],sources:[],usage:{voiceSeconds:0,backendInputTokens:0,backendOutputTokens:0}};
  record.delivery=new SpeechDelivery({send:event=>send(record,event),language:config.language,
    canNudge:answer=>!record.closing&&!record.closed&&(answer.forceSpeak||(answer.contextVersion===record.taskVersion&&Date.now()-record.lastInputAt>1500)),
    onUpdate:answer=>{
      if(record.delivery.items.at(-1)===answer)record.backendStatus=answer.message;
      console.log(JSON.stringify({event:'answer.delivery',answerId:answer.id,state:answer.state}));
    }
  });
  record.expiry=setTimeout(()=>closeSession(id),config.sessionMinutes*60000);
  sessions.set(id,record);
  socket.on('message',raw=>{
    let event;try{event=JSON.parse(raw.toString());}catch{return;}
    record.delivery.process(event);
    if(event.type==='session.input_transcript.delta')appendHistory(record,'user',event);
    if(event.type==='session.output_transcript.delta')appendHistory(record,'assistant',event);
    if(event.type==='session.delegation.created'&&event.delegation?.target==='client'){
      const taskId=event.delegation.id;
      if(typeof taskId==='string'&&!record.seen.has(taskId)){
        record.seen.add(taskId);record.backendStatus='排队处理';const version=++record.taskVersion;
        record.queue=record.queue.then(()=>handleDelegation(record,taskId,version)).catch(error=>{record.backendStatus=`后端失败：${safeMessage(error.message)}`;});
      }
    }
    if(event.type==='session.usage.updated'&&Number.isFinite(event.usage?.seconds))record.usage.voiceSeconds=event.usage.seconds;
    if(event.type==='error'){record.backendStatus=`会话事件错误：${safeMessage(event.error?.message)}`;}
    if(event.type==='session.closed'){
      record.usage.voiceSeconds=event.usage?.seconds??record.usage.voiceSeconds;
      console.log(JSON.stringify({event:'session.closed',seconds:event.usage?.seconds,reason:event.reason,backendTokens:record.usage.backendInputTokens+record.usage.backendOutputTokens}));
      cleanup(record);socket.close();
    }
  });
  socket.on('error',()=>{record.backendStatus='后端控制连接失败，请重新连接会话';});
  socket.on('close',()=>{if(!record.closing&&!record.closed)record.backendStatus='后端控制连接已断开，请重新连接';cleanup(record);});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(new Error('无法建立后端控制连接')));});
  if(record.closing)send(record,{type:'session.close'});
  return record;
}

  const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
  const server=http.createServer(async(req,res)=>{
    res.uiLanguage=requestLanguage(req.headers['accept-language']);
    try{
      const path=new URL(req.url,'http://local.invalid').pathname;
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
      if(req.method==='GET'&&path==='/api/health')return reply(res,200,{ok:true});
      let localAuthority='';
      try{const authority=new URL('http://'+String(req.headers.host||''));if(['127.0.0.1','localhost','[::1]'].includes(authority.hostname)&&!authority.username&&!authority.password)localAuthority=authority.host;}catch{}
      const allowedHosts=mode==='remote'?[new URL(origin).host]:[localAuthority].filter(Boolean);
      if(!allowedHosts.includes(req.headers.host))return reply(res,403,{error:'访问地址不匹配，请使用程序显示的地址'});
      const allowedOrigins=mode==='remote'?[origin]:allowedHosts.map(h=>`http://${h}`);
      if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))return reply(res,403,{error:'请求来源不允许'});
      if(req.method==='GET'&&path==='/api/bootstrap')return reply(res,200,{configured:store.configured(),mode,authenticated:auth.authorized(req),needsSetupToken:auth.needsSetupToken()});
      if(req.method==='POST'&&path==='/api/auth/login'){
        if(!String(req.headers['content-type']).startsWith('application/json'))return reply(res,415,{error:'需要 JSON 请求'});
        try{auth.login(req,res,await body(req));return reply(res,200,{ok:true});}catch(error){return reply(res,401,{error:error.message});}
      }
      if(req.method==='POST'&&path==='/api/auth/logout'){auth.logout(req,res);return reply(res,200,{ok:true});}
      if(path.startsWith('/api/')&&!auth.authorized(req))return reply(res,401,{error:'请先登录管理员账户',code:'AUTH_REQUIRED'});
      if(req.method==='GET'&&!path.startsWith('/api/')){
        if(path==='/favicon.ico'){res.writeHead(204);return res.end();}
        if(path==='/'&&(!store.configured()||!auth.authorized(req)||auth.needsSetupToken())){res.writeHead(302,{Location:'/setup'});return res.end();}
        const relative=path==='/setup'?'setup.html':path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,'');
        const file=resolve(publicRoot,relative);
        if(!file.startsWith(resolve(publicRoot)+sep))return reply(res,404,{error:'Not found'});
        const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
        if(!types[extname(file)])return reply(res,404,{error:'Not found'});
        try{res.setHeader('Content-Type',types[extname(file)]);return res.end(await readFile(file));}catch{return reply(res,404,{error:'Not found'});}
      }
      if(req.method==='GET'&&path==='/api/config')return reply(res,200,{...publicConfig(store.get(),store.configured()),mode});
      if(req.method==='GET'&&path==='/api/settings')return reply(res,200,publicSettings(store.get()));
      if(req.method==='GET'&&path==='/api/diagnostics'){
        res.setHeader('Content-Disposition','attachment; filename="diagnostics.json"');
        return reply(res,200,{application:'gpt-live-1-demo',node:process.versions.node,platform:process.platform,configured:store.configured(),backendEnabled:store.get().backend.enabled,activeSessions:sessions.size,mode});
      }
      if(req.method==='POST'&&['/api/settings','/api/settings/test'].includes(path)){
        if(!String(req.headers['content-type']).startsWith('application/json'))return reply(res,415,{error:'需要 JSON 请求'});
        if(sessions.size||creating)return reply(res,409,{error:'请先断开当前语音会话，再修改连接设置'});
        const input=await body(req);const candidate=mergeSettings(input.settings,store.get());
        const normalized=validateConfig(candidate.preferences,candidate);
        candidate.preferences=Object.fromEntries(Object.keys(candidate.preferences).filter(k=>!['backendProvider','backendModel','backendReady'].includes(k)).map(k=>[k,normalized[k]]).filter(([,v])=>v!==undefined));
        if(path==='/api/settings/test'){
          if(!['voice','backend'].includes(input.kind))return reply(res,400,{error:'请选择要测试的连接'});
          return reply(res,200,await verify(input.kind,candidate));
        }
        if(mode==='remote'&&!candidate.admin)candidate.admin=passwordHash(input.adminPassword);
        else if(input.adminPassword)candidate.admin=passwordHash(input.adminPassword);
        await verify('voice',candidate);if(candidate.backend.enabled)await verify('backend',candidate);
        await store.save(candidate);return reply(res,200,{ok:true,message:'配置已保存，可以开始体验'});
      }
      const statusMatch=path.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/status$/);
      if(req.method==='GET'&&statusMatch){const record=sessions.get(statusMatch[1]);return reply(res,record||recentStatuses.has(statusMatch[1])?200:404,record?statusOf(record):recentStatuses.get(statusMatch[1])||{error:'会话已结束'});}
      const closeMatch=path.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/close$/);
      if(req.method==='POST'&&closeMatch){closeSession(closeMatch[1]);return reply(res,200,{ok:true});}
      const speakMatch=path.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/speak$/);
      if(req.method==='POST'&&speakMatch){
        const record=sessions.get(speakMatch[1]);if(!record||record.closing||record.closed)return reply(res,410,{error:'会话已结束，请重新连接'});
        if(!String(req.headers['content-type']).startsWith('application/json'))return reply(res,415,{error:'需要 JSON 请求'});
        record.delivery.replay((await body(req)).answerId);return reply(res,200,{ok:true});
      }
      if(req.method!=='POST'||!['/api/session','/api/backend/test'].includes(path))return reply(res,404,{error:'Not found'});
      if(!store.configured())return reply(res,409,{error:'请先完成连接向导',code:'SETUP_REQUIRED'});
      if(!String(req.headers['content-type']).startsWith('application/json'))return reply(res,415,{error:'需要 JSON 请求'});
      const input=await body(req);const settings=store.get(),config=validateConfig(input.config||{},settings),backend=backendConnection(settings);
      if(path==='/api/backend/test')return reply(res,200,{...await verify('backend',settings),model:settings.backend.model,provider:'已配置后端'});
      if(creating||sessions.size)return reply(res,409,{error:'已有语音会话，请先断开'});
      if(typeof input.sdp!=='string'||!input.sdp.startsWith('v=0')||!input.sdp.includes('m=audio'))return reply(res,400,{error:'无效的音频连接请求'});
      creating=true;let sessionId;
      res.on('close',()=>{if(!res.writableEnded&&sessionId)closeSession(sessionId);});
      try{
        const upstream=await fetch(`${settings.voice.baseUrl}/live/sessions`,{method:'POST',headers:{...voiceHeaders(settings.voice),'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),redirect:'error',
          body:JSON.stringify({session:{model:settings.voice.model,instructions:liveInstructions(config),audio:{output:{voice:config.voice}},delegation:{type:'client'}},transport:{type:'webrtc',sdp:input.sdp}})});
        const result=await upstream.json().catch(()=>({}));
        if(!upstream.ok){const e=new Error(result.error?.message);e.status=upstream.status;throw new Error(friendlyApiError(e));}
        sessionId=result.session?.id;if(!sessionId||typeof result.transport?.sdp!=='string')throw new Error('语音服务返回格式不兼容');
        await attach(sessionId,config,backend,settings.voice);
        if(res.destroyed){closeSession(sessionId);return;}
        reply(res,200,{sessionId,sdp:result.transport.sdp});
      }catch(error){if(sessionId)closeSession(sessionId);reply(res,502,{error:safeMessage(error.message)});}
      finally{creating=false;}
    }catch(error){reply(res,400,{error:safeMessage(error.message)});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  for(let attempt=0;;attempt++){
    try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});break;}
    catch(error){if(error.code==='EADDRINUSE'&&options.autoPort&&!process.env.PORT&&attempt<20){port++;continue;}throw new Error(error.code==='EADDRINUSE'?'端口已被占用，请关闭旧实例或设置其他 PORT':'服务无法启动，请检查监听地址和端口');}
  }
  port=server.address().port;if(mode==='local')origin=`http://127.0.0.1:${port}`;
  if(!options.quiet){console.log(`Ready: ${origin}`);if(auth.needsSetupToken())console.log(`Setup: ${origin}/setup#setup-token=${encodeURIComponent(auth.initialToken)}`);}
  let closing;
  async function close(){if(closing)return closing;closing=(async()=>{for(const id of sessions.keys())closeSession(id);const until=Date.now()+5500;while(sessions.size&&Date.now()<until)await delay(100);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});})();return closing;}
  return {url:origin,port,dataDir:store.dataDir,close,server};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  startServer().then(app=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}).catch(error=>{console.error(translateMessage(error.message,'en'));process.exitCode=1;});
}
