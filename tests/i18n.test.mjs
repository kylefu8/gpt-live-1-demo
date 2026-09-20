import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {localizeResponse,translateMessage,requestLanguage,backendPhase} from '../ui-messages.mjs';

test('page catalogs cover referenced keys and keep interpolation parameters aligned',()=>{
 for(const page of ['main','setup']){
  let catalog;
  runInNewContext(readFileSync(new URL(`../public/locales/${page}.js`,import.meta.url),'utf8'),{window:{AppI18n:{register:value=>{catalog=value;}}}});
  const html=readFileSync(new URL(`../public/${page==='main'?'index':'setup'}.html`,import.meta.url),'utf8');
  for(const match of html.matchAll(new RegExp(`["'](${page}\\.[\\w.]+)["']`,'g')))assert.ok(catalog[match[1]],`Missing ${match[1]}`);
  for(const [key,entry]of Object.entries(catalog)){
   assert.equal(typeof entry.en,'string',key);assert.equal(typeof entry['zh-CN'],'string',key);
   const params=value=>[...value.matchAll(/\{([\w.-]+)\}/g)].map(m=>m[1]).sort();
   assert.deepEqual(params(entry.en),params(entry['zh-CN']),key);
  }
 }
});

test('API language negotiation and application errors support English and Chinese',()=>{
 assert.equal(requestLanguage('en-US,en;q=0.9'),'en');
 assert.equal(requestLanguage('zh-CN,zh;q=0.9'),'zh-CN');
 assert.equal(translateMessage('管理员密码不正确','en'),'The administrator password is incorrect.');
 assert.equal(translateMessage('管理员密码不正确','zh-CN'),'管理员密码不正确');
 assert.equal(translateMessage('sessionMinutes 需要介于 1 和 30','en'),'sessionMinutes must be between 1 and 30.');
});
test('backend phases stay independent of translated labels and previous answers',()=>{
 assert.equal(backendPhase({backendStatus:'就绪'}),'ready');
 assert.equal(backendPhase({backendStatus:'正在处理',taskVersion:2,delivery:{items:[{contextVersion:1,state:'speaking'}]}}),'processing');
 assert.equal(backendPhase({backendStatus:'语音服务已接收，等待播报',taskVersion:2,delivery:{items:[{contextVersion:2,state:'accepted'}]}}),'accepted');
 assert.equal(backendPhase({closed:true}),'ended');
});
test('localizing status never translates user content or connection identifiers',()=>{
 const data={backendStatus:'正在处理',answers:[{text:'正在处理',message:'语音服务已接收，等待播报',id:'answer_1'}],tools:[{name:'get_current_time',summary:'已取得结果'}],defaults:{instructions:'正在处理',language:'zh-CN'},sources:[{title:'正在处理',url:'https://example.com'}]};
 const translated=localizeResponse(data,'en');
 assert.equal(translated.backendStatus,'Processing');
 assert.equal(translated.answers[0].text,'正在处理');
 assert.equal(translated.answers[0].id,'answer_1');
 assert.equal(translated.tools[0].name,'get_current_time');
 assert.equal(translated.tools[0].summary,'Result received');
 assert.deepEqual(translated.defaults,data.defaults);assert.deepEqual(translated.sources,data.sources);
 assert.equal(data.backendStatus,'正在处理');
});
