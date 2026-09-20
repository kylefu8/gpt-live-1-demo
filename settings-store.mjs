import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';

export function defaultDataDir(){
  if(process.env.APP_DATA_DIR)return process.env.APP_DATA_DIR;
  if(process.platform==='win32')return join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'GPTLiveDemo');
  if(process.platform==='darwin')return join(homedir(),'Library','Application Support','GPTLiveDemo');
  return join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'gpt-live-demo');
}
export const preferenceDefaults={voice:'marin',language:'auto',instructions:'Be helpful, concise, and natural.',timeZone:'UTC',city:'',webSearch:true,maxOutputTokens:1024,reasoningEffort:'low',sessionMinutes:10};
export function emptySettings(){return {version:1,voice:{provider:'azure',baseUrl:'',model:'gpt-live-1',apiKey:''},backend:{enabled:false,mode:'custom',baseUrl:'',model:'',auth:'bearer',apiKey:''},preferences:{...preferenceDefaults}};}
export function normalizeBaseUrl(value,provider='compatible'){
  let url;try{url=new URL(String(value||'').trim());}catch{throw new Error('地址格式不正确，请粘贴完整的 https:// 资源地址');}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('服务地址必须使用 HTTPS，且不能在地址中包含密钥');
  if([...url.searchParams.keys()].some(x=>!['api-version'].includes(x)))throw new Error('请填写不含查询参数和密钥的服务地址');
  url.search='';url.hash='';
  let path=url.pathname.replace(/\/+$/,'').replace(/\/(?:live\/sessions|responses)$/,'');
  if(!path)path=provider==='azure'?'/openai/v1':'/v1';
  else if(path==='/openai')path='/openai/v1';
  url.pathname=path;return url.href.replace(/\/$/,'');
}
function secret(value){if(typeof value!=='string'||value.length>4096||/[\r\n]/.test(value))throw new Error('API Key 格式不正确');return value.trim();}
function model(value,label){if(typeof value!=='string'||!/^[A-Za-z0-9_.:/-]{1,120}$/.test(value))throw new Error(`请填写有效的${label}`);return value;}
export function mergeSettings(input,previous=emptySettings()){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('配置格式不正确');
  const voice=input.voice||{},old=previous.voice||{};
  const provider=voice.provider||old.provider||'azure';
  if(!['azure','compatible'].includes(provider))throw new Error('请选择支持的语音服务类型');
  const baseUrl=normalizeBaseUrl(voice.baseUrl??old.baseUrl,provider);
  const same=baseUrl===old.baseUrl&&provider===old.provider;
  const suppliedVoice=voice.apiKey===undefined?'':secret(voice.apiKey);
  const voiceKey=suppliedVoice||(same?old.apiKey:'');
  if(!voiceKey)throw new Error('请输入语音服务 API Key；更换地址后需要重新填写');
  const rawPreferences={...preferenceDefaults,...previous.preferences,...input.preferences};
  const preferences=Object.fromEntries(Object.keys(preferenceDefaults).map(key=>[key,rawPreferences[key]]));
  const result={version:1,voice:{provider,baseUrl,model:model(voice.model??old.model,'语音部署名'),apiKey:voiceKey},backend:{...emptySettings().backend},preferences};
  const b=input.backend||previous.backend||{};
  result.backend.enabled=b.enabled===true;
  if(result.backend.enabled){
    const mode=b.mode==='same'?'same':'custom';
    const auth=mode==='same'?(provider==='azure'?'api-key':'bearer'):(b.auth||'bearer');
    if(!['bearer','api-key'].includes(auth))throw new Error('鉴权方式不正确');
    const backendUrl=mode==='same'?baseUrl:normalizeBaseUrl(b.baseUrl,auth==='api-key'?'azure':'compatible');
    const oldBackend=previous.backend||{};
    const unchanged=oldBackend.baseUrl===backendUrl&&oldBackend.auth===auth;
    const suppliedBackend=b.apiKey===undefined?'':secret(b.apiKey);
    const key=mode==='same'?voiceKey:(suppliedBackend||(unchanged?oldBackend.apiKey:''));
    if(!key)throw new Error('请输入推理后端 API Key；更换地址后需要重新填写');
    result.backend={enabled:true,mode,baseUrl:backendUrl,auth,model:model(b.model,'推理模型或部署名'),apiKey:key};
  }
  if(previous.admin)result.admin=previous.admin;
  return result;
}
export function publicSettings(s){
  return {voice:{provider:s.voice.provider,baseUrl:s.voice.baseUrl,model:s.voice.model,keyConfigured:Boolean(s.voice.apiKey)},
    backend:{enabled:s.backend.enabled,mode:s.backend.mode,baseUrl:s.backend.baseUrl,model:s.backend.model,auth:s.backend.auth,keyConfigured:Boolean(s.backend.apiKey)},preferences:s.preferences};
}
export function passwordHash(password){if(typeof password!=='string'||password.length<10||password.length>256)throw new Error('管理员密码至少需要 10 个字符');const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,salt,64).toString('hex')};}
export function checkPassword(password,admin){if(typeof password!=='string'||password.length>256||!admin?.salt||!admin.hash)return false;try{return timingSafeEqual(scryptSync(password,admin.salt,64),Buffer.from(admin.hash,'hex'));}catch{return false;}}
export async function createSettingsStore(dataDir=defaultDataDir()){
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const path=join(dataDir,'settings.json');let settings=emptySettings();
  try{const value=JSON.parse(await readFile(path,'utf8'));if(value.version!==1)throw new Error('不支持的配置版本');settings=value;}catch(error){if(error.code!=='ENOENT')throw new Error('私有配置无法读取。请备份配置目录后检查 settings.json。');}
  if(!settings.voice.apiKey&&process.env.LIVE_BASE_URL&&process.env.LIVE_API_KEY){
    settings=mergeSettings({voice:{provider:process.env.LIVE_PROVIDER||'azure',baseUrl:process.env.LIVE_BASE_URL,apiKey:process.env.LIVE_API_KEY,model:process.env.LIVE_MODEL||'gpt-live-1'},backend:{enabled:Boolean(process.env.REASONING_BASE_URL&&process.env.REASONING_API_KEY&&process.env.REASONING_MODEL),mode:'custom',baseUrl:process.env.REASONING_BASE_URL,apiKey:process.env.REASONING_API_KEY,model:process.env.REASONING_MODEL,auth:process.env.REASONING_AUTH||'bearer'}},settings);
  }
  return {dataDir,path,get:()=>settings,configured:()=>Boolean(settings.voice.apiKey&&settings.voice.baseUrl),async save(value){
    const temp=join(dataDir,`.settings-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temp,path);settings=value;
  }};
}
