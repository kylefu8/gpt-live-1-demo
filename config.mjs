import {preferenceDefaults} from './settings-store.mjs';
export const voices=[['marin','Marin · 默认'],['quartz','Quartz'],['ripple','Ripple'],['vesper','Vesper'],['willow','Willow'],['stone','Stone'],['gleam','Gleam'],['meridian','Meridian'],['bossa','Bossa'],['tempo','Tempo'],['beacon','Beacon'],['delta','Delta'],['cinder','Cinder']].map(([id,label])=>({id,label}));
export function validateConfig(input={},settings={preferences:preferenceDefaults,backend:{enabled:false,model:''}}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('会话设置格式不正确');
  const c={...preferenceDefaults,...settings.preferences};
  for(const key of Object.keys(preferenceDefaults))if(input[key]!==undefined)c[key]=input[key];
  if(!voices.some(v=>v.id===c.voice))throw new Error('请选择列表中的音色');
  if(!['zh-CN','en-US','auto'].includes(c.language))throw new Error('请选择支持的语言');
  if(typeof c.instructions!=='string'||c.instructions.length>1500)throw new Error('助手指令最多 1500 个字符');
  if(typeof c.city!=='string'||c.city.length>100)throw new Error('城市名称过长');
  if(typeof c.timeZone!=='string'||c.timeZone.length>100)throw new Error('时区格式不正确');
  try{new Intl.DateTimeFormat('zh-CN',{timeZone:c.timeZone}).format();}catch{throw new Error('请输入有效时区，例如 UTC 或 Asia/Shanghai');}
  if(typeof c.webSearch!=='boolean')throw new Error('联网搜索设置不正确');
  for(const [key,min,max]of[['maxOutputTokens',256,4096],['sessionMinutes',1,30]])if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw new Error(`${key} 需要介于 ${min} 和 ${max}`);
  if(!['none','low','medium','high'].includes(c.reasoningEffort))throw new Error('推理强度不正确');
  c.webSearch=c.webSearch&&Boolean(settings.backend?.enabled);
  return {...c,backendProvider:'configured',backendModel:settings.backend?.model||'',backendReady:Boolean(settings.backend?.enabled)};
}
export function publicConfig(settings,configured){return {configured,voices,defaults:validateConfig({},settings),backendReady:Boolean(settings.backend.enabled),backendModels:settings.backend.model?[{id:settings.backend.model,label:settings.backend.model}]:[],backendProviderLabel:settings.backend.enabled?'已配置推理后端':'仅语音与时间工具',webSearchAvailable:Boolean(settings.backend.enabled)};}
export function liveInstructions(c){
 const language=c.language==='zh-CN'?'始终用中文回答，只有用户明确要求时才换语言':c.language==='en-US'?'Answer in English unless the user asks for another language':'使用用户正在使用的语言回答';
 const capabilities=c.backendReady?`推理、精确计算、当前时间、天气${c.webSearch?'、联网搜索':''}`:'当前时间、日期和星期；复杂推理、天气和搜索需要用户先配置推理后端';
 return `你是一位实时语音助手。${language}。${c.instructions}\n默认时区：${c.timeZone}；默认城市：${c.city||'未设置，查询天气前先询问'}。\nBackchannel policy: 适度回应，不抢话。\nInterruption policy: 用户插话时停下来听。\nDelegation policy:\nBackend tools: ${capabilities}。\nDelegate to the backend when: 用户询问时间、星期、天气、计算、实时信息或需要推理的问题。等待实际工具结果再回答，不编造查询结果。\nDo not delegate to the backend when: 简单问候、必要澄清或重复已有结果。音色通过页面选择，在新会话生效。`;
}
