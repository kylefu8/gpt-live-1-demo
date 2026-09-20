import {readFileSync} from 'node:fs';
const messages=JSON.parse(readFileSync(new URL('./public/locales/messages.json',import.meta.url),'utf8'));
export function requestLanguage(header=''){const first=String(header).split(',')[0].toLowerCase();return first.startsWith('en')?'en':'zh-CN';}
export function translateMessage(value,language){
 if(typeof value!=='string'||language!=='en')return value;
 if(messages[value])return messages[value];
 const patterns=[
  [/^无法识别时区：(.*)。$/,'Unrecognized time zone: $1.'],
  [/^找不到地点：(.*)。$/,'Location not found: $1.'],
  [/^地点“(.*)”有多个匹配，请选择具体城市。$/,'Multiple locations match "$1". Choose a specific city.'],
  [/^(.*?) 超过 (\d+) 个字符。$/,'$1 exceeds $2 characters.'],
  [/^天气服务返回了 HTTP (\d+)。$/,'The weather service returned HTTP $1.'],
  [/^天气服务请求失败：(.*)$/,'Weather request failed: $1'],
  [/^未知工具：(.*)。$/,'Unknown tool: $1.'],
  [/^(.*?) 的参数必须是 JSON 对象。$/,'Arguments for $1 must be a JSON object.'],
  [/^(.*?) 包含未知参数：(.*)。$/,'$1 contains unknown arguments: $2.'],
  [/^(.*?) 缺少必需参数：(.*)。$/,'$1 is missing required arguments: $2.'],
  [/^(.*?) 必须是字符串或 null。$/,'$1 must be a string or null.'],
  [/^(.*?) 不能为空字符串。$/,'$1 must not be an empty string.']
 ];
 for(const [pattern,replacement]of patterns)if(pattern.test(value))return value.replace(pattern,replacement);
 let m=value.match(/^(.*?) 需要介于 (\d+) 和 (\d+)$/);if(m)return `${m[1]} must be between ${m[2]} and ${m[3]}.`;
 for(const [from,to]of [['后端失败：','Backend failed: '],['会话事件错误：','Session event error: '],['语音回传失败：','Voice delivery failed: '],['后端 HTTP ','Backend HTTP ']])if(value.startsWith(from))return to+translateMessage(value.slice(from.length),language);
 return value;
}
// Translate application metadata only. Model replies, transcripts, prompts,
// identifiers, and provider source titles must keep their original content.
export function localizeResponse(data,language){
 if(!data||typeof data!=='object'||Array.isArray(data)||language!=='en')return data;
 const result={...data};
 for(const key of ['error','message','backendStatus','backendProviderLabel'])if(typeof result[key]==='string')result[key]=translateMessage(result[key],language);
 if(Array.isArray(result.tools))result.tools=result.tools.map(tool=>({...tool,summary:translateMessage(tool.summary,language)}));
 if(Array.isArray(result.answers))result.answers=result.answers.map(answer=>({...answer,message:translateMessage(answer.message,language)}));
 if(Array.isArray(result.voices))result.voices=result.voices.map(voice=>({...voice,label:translateMessage(voice.label,language)}));
 return result;
}
export function backendPhase(record){
 if(record.closed)return 'ended';
 const latest=record.delivery?.items?.at(-1);
 if(latest&&latest.contextVersion===record.taskVersion)return latest.state;
 const status=String(record.backendStatus||'');
 if(/失败|错误|超时/.test(status))return 'failed';
 if(/排队/.test(status))return 'queued';
 if(/就绪/.test(status))return 'ready';
 if(/已结束/.test(status))return 'ended';
 return 'processing';
}
