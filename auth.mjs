import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {checkPassword} from './settings-store.mjs';
const digest=s=>createHash('sha256').update(s).digest();
function equal(a,b){return timingSafeEqual(digest(a),digest(b));}
export function createAuth({mode,store,setupToken}){
  const sessions=new Map(),attempts=new Map();
  const initialToken=setupToken||randomBytes(24).toString('base64url');
  const cookieName='voice_admin';
  function authorized(req){
    if(mode==='local')return true;
    const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const expires=sessions.get(id);if(expires&&expires>Date.now())return true;if(id)sessions.delete(id);return false;
  }
  function login(req,res,input){
    if(mode==='local')return;
    const client=req.socket.remoteAddress||'unknown';const prior=attempts.get(client)||{count:0,since:Date.now()};
    if(Date.now()-prior.since>60000){prior.count=0;prior.since=Date.now();}
    if(prior.count>=10)throw new Error('尝试次数过多，请一分钟后再试');
    const admin=store.get().admin;
    const valid=admin?checkPassword(input.password,admin):(typeof input.setupToken==='string'&&equal(input.setupToken,initialToken));
    if(!valid){prior.count++;attempts.set(client,prior);throw new Error(admin?'管理员密码不正确':'初始化口令不正确，请从部署控制台获取');}
    attempts.delete(client);const id=randomBytes(32).toString('base64url');sessions.set(id,Date.now()+12*3600000);
    res.setHeader('Set-Cookie',`${cookieName}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
  }
  function logout(req,res){const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(id)sessions.delete(id);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);}
  return {authorized,login,logout,initialToken,needsSetupToken:()=>mode==='remote'&&!store.get().admin};
}
