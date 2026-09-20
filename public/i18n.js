(() => {
  'use strict';
  const storageKey='voice-demo-ui-language';
  const entries=new Map();
  let serverMessages={};
  const normalize=value=>String(value||'').toLowerCase().startsWith('zh')?'zh-CN':'en';
  let language=normalize(navigator.language);
  try{const saved=localStorage.getItem(storageKey);if(saved==='en'||saved==='zh-CN')language=saved;}catch{}
  const format=(text,params)=>String(text).replace(/\{([\w.-]+)\}/g,(match,key)=>params[key]===undefined?match:String(params[key]));
  function t(key,params={}){const entry=entries.get(key);return format(entry?.[language]??entry?.en??entry?.['zh-CN']??key,params);}
  function apply(root=document){
    document.documentElement.lang=language==='en'?'en':'zh-CN';
    for(const [attribute,target]of [['data-i18n',null],['data-i18n-placeholder','placeholder'],['data-i18n-title','title'],['data-i18n-aria-label','aria-label']]){
      const nodes=[...(root.matches?.(`[${attribute}]`)?[root]:[]),...root.querySelectorAll(`[${attribute}]`)];
      for(const element of nodes){const key=element.getAttribute(attribute);if(!entries.has(key))continue;const value=t(key);if(target)element.setAttribute(target,value);else element.textContent=value;}
    }
    for(const select of document.querySelectorAll('#uiLanguageSelect,[data-ui-language]'))select.value=language;
  }
  function notify(){apply();document.dispatchEvent(new CustomEvent('app-language-change',{detail:{language}}));}
  function setLanguage(value){const next=normalize(value);try{localStorage.setItem(storageKey,next);}catch{}if(next!==language){language=next;notify();}else apply();}
  function register(dictionary){for(const [key,value]of Object.entries(dictionary))entries.set(key,value);apply();}
  function error(value){
    if(typeof value!=='string')return value;
    for(const [zh,en]of Object.entries(serverMessages)){if(value===zh||value===en)return language==='en'?en:zh;}
    for(const entry of entries.values()){if(value===entry.en||value===entry['zh-CN'])return entry[language]??value;}
    const prefixes=[['后端失败：','Backend failed: '],['会话事件错误：','Session event error: '],['语音回传失败：','Voice delivery failed: '],['后端 HTTP ','Backend HTTP ']];
    for(const pair of prefixes)for(const prefix of pair)if(value.startsWith(prefix))return pair[language==='en'?1:0]+error(value.slice(prefix.length));
    return value;
  }
  function apiFetch(input,options={}){
    let isLocal=false;try{isLocal=new URL(input instanceof Request?input.url:input,location.href).origin===location.origin;}catch{}
    if(!isLocal)return fetch(input,options);
    const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
    headers.set('Accept-Language',language==='en'?'en':'zh-CN');return fetch(input,{...options,headers});
  }
  window.AppI18n={register,t,getLanguage:()=>language,setLanguage,apply,apiFetch,error};
  window.addEventListener('storage',event=>{if(event.key===storageKey&&event.newValue&&normalize(event.newValue)!==language){language=normalize(event.newValue);notify();}});
  document.addEventListener('DOMContentLoaded',()=>apply());
  fetch('/locales/messages.json').then(r=>r.ok?r.json():{}).then(value=>{serverMessages=value;notify();}).catch(()=>{});
  apply();
})();
