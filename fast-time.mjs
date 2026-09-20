import {executeTool} from './tools.mjs';

// Only route standalone clock questions here; broader questions still use the backend.
export async function fastTimeAnswer(history,config,now=new Date()) {
  const text=history.findLast(item=>item.role==='user')?.text?.trim()||'';
  const normalized=text.replace(/[\s，。！？?,.!]/gu,'').toLowerCase();
  const chinese=/^(?:你好)?(?:请问|请告诉我|告诉我|我想问|我想知道)?(?:北京时间|上海时间)?(?:今天(?:是)?(?:星期几|周几|礼拜几|几号|多少号|什么日期|几月几号)|现在(?:是)?几点(?:钟)?|现在的时间|当前时间)(?:呀|啊|呢|吗|吧|谢谢|了)*$/u;
  const english=/^(?:please)?(?:whatdayoftheweekisittoday|whatdayisittoday|whatisthedatetoday|whatisthecurrenttime|whattimeisit)$/;
  if(!chinese.test(normalized)&&!english.test(normalized))return null;
  const timeZone=/北京时间|上海时间/.test(normalized)?'Asia/Shanghai':config.timeZone;
  const result=await executeTool('get_current_time',{time_zone:timeZone},{now});
  if(!result.ok)throw new Error(result.error.message);
  const englishReply=config.language==='en-US'||(config.language==='auto'&&english.test(normalized));
  const wantsTime=/几点|时间$|time/.test(normalized);
  let answer;
  if(englishReply){
    answer=wantsTime?`The current time in ${timeZone} is ${result.time}.`:`Today is ${new Intl.DateTimeFormat('en-US',{timeZone,dateStyle:'full'}).format(now)}.`;
  }else{
    const [year,month,day]=result.date.split('-').map(Number);
    answer=wantsTime?`按 ${timeZone} 时区，现在是 ${result.time}。`:`今天是 ${year} 年 ${month} 月 ${day} 日，${result.weekday}。`;
  }
  return {text:answer,result};
}
