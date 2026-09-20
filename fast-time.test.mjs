import test from 'node:test';
import assert from 'node:assert/strict';
import {fastTimeAnswer} from './fast-time.mjs';
const config={timeZone:'Asia/Shanghai',language:'zh-CN'};
const now=new Date('2026-09-20T00:15:00Z');
test('standalone weekday question uses the local clock',async()=>{
  const r=await fastTimeAnswer([{role:'user',text:'今天星期几呀？'}],config,now);
  assert.equal(r.text,'今天是 2026 年 9 月 20 日，星期日。');
});
test('specified Beijing time overrides the session zone',async()=>{
  const r=await fastTimeAnswer([{role:'user',text:'北京时间现在几点？'}],{...config,timeZone:'America/Los_Angeles'},now);
  assert.match(r.text,/08:15:00/);
});
test('complex requests are not mistaken for standalone time questions',async()=>{
  for(const text of ['今天星期几，并查明天天气','为什么今天是星期日','计算今天到明年还有多少天']){
    assert.equal(await fastTimeAnswer([{role:'user',text}],config,now),null);
  }
});
