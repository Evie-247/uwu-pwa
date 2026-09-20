import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import webpush from 'web-push';
import crypto from 'node:crypto';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
const PORT = Number(process.env.PORT || 3000);
const CLIENT_TOKEN = process.env.CLIENT_TOKEN || '';
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const INTERVAL = Math.max(60_000, Number(process.env.SCHEDULER_INTERVAL_MS || 60_000));

app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN }));
app.use(express.json({ limit: '3mb' }));

function auth(req,res,next){ if (!CLIENT_TOKEN || req.get('X-UwU-Token') !== CLIENT_TOKEN) return res.status(401).send('Unauthorized'); next(); }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function intervalMs(ar={}) {
  if ((ar.mode || 'fixed') === 'random') return rand(Number(ar.minInterval || 60), Number(ar.maxInterval || 180)) * 60_000;
  return Number(ar.interval || 60) * 60_000;
}
function lastHistoryTime(s){ const h=s.history||[]; return Number(h[h.length-1]?.timestamp||0); }
function nextDue(snapshot, now=Date.now()) {
  const base = Math.max(lastHistoryTime(snapshot), Number(snapshot.autoReply?.lastTriggerTime||0), now);
  return base + intervalMs(snapshot.autoReply);
}

async function ensureSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS characters(id TEXT PRIMARY KEY,snapshot JSONB NOT NULL,next_due_at BIGINT,last_generated_at BIGINT DEFAULT 0,updated_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,subscription JSONB NOT NULL,updated_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS pending_messages(id TEXT PRIMARY KEY,character_id TEXT NOT NULL,message JSONB NOT NULL,created_at BIGINT NOT NULL,acked BOOLEAN NOT NULL DEFAULT FALSE);
  CREATE INDEX IF NOT EXISTS idx_pending_unacked ON pending_messages(acked,created_at);
  CREATE INDEX IF NOT EXISTS idx_char_due ON characters(next_due_at);`);
}

app.get('/health', (_,res)=>res.json({ok:true,time:Date.now()}));
app.get('/api/config', auth, (_,res)=>res.json({vapidPublicKey:process.env.VAPID_PUBLIC_KEY||''}));

app.post('/api/characters/sync', auth, async (req,res)=>{
  const s=req.body;
  if(!s?.id) return res.status(400).send('Missing character id');
  const old=await pool.query('SELECT snapshot,next_due_at,last_generated_at FROM characters WHERE id=$1',[s.id]);
  let due=old.rows[0]?.next_due_at;
  const oldSnap=old.rows[0]?.snapshot;
  const scheduleChanged=JSON.stringify(oldSnap?.autoReply||{})!==JSON.stringify(s.autoReply||{});
  const newestClient=lastHistoryTime(s);
  const lastGenerated=Number(old.rows[0]?.last_generated_at||0);
  if(!due || scheduleChanged || newestClient>lastGenerated) due=nextDue(s);
  await pool.query(`INSERT INTO characters(id,snapshot,next_due_at,last_generated_at,updated_at) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(id) DO UPDATE SET snapshot=EXCLUDED.snapshot,next_due_at=$3,updated_at=$5`,[s.id,s,due,lastGenerated,Date.now()]);
  res.json({ok:true,nextDueAt:Number(due)});
});

app.post('/api/push/subscribe', auth, async (req,res)=>{
  const sub=req.body; if(!sub?.endpoint) return res.status(400).send('Bad subscription');
  await pool.query(`INSERT INTO push_subscriptions(endpoint,subscription,updated_at) VALUES($1,$2,$3)
    ON CONFLICT(endpoint) DO UPDATE SET subscription=EXCLUDED.subscription,updated_at=EXCLUDED.updated_at`,[sub.endpoint,sub,Date.now()]);
  res.json({ok:true});
});

app.get('/api/messages/pending', auth, async (_,res)=>{
  const r=await pool.query('SELECT id,character_id,message,created_at FROM pending_messages WHERE acked=false ORDER BY created_at ASC LIMIT 200');
  res.json({messages:r.rows.map(x=>({id:x.id,characterId:x.character_id,message:x.message,createdAt:Number(x.created_at)}))});
});
app.post('/api/messages/ack', auth, async (req,res)=>{
  const ids=Array.isArray(req.body?.ids)?req.body.ids:[]; if(!ids.length)return res.json({ok:true});
  await pool.query('UPDATE pending_messages SET acked=true WHERE id = ANY($1::text[])',[ids]); res.json({ok:true});
});

function buildMessages(s, serverMessages=[]) {
  const history=[...(s.history||[]),...serverMessages].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0)).slice(-Math.min(Number(s.maxMemory||100),120));
  const system = `You are ${s.realName}. Stay strictly in character.\n\nCharacter persona:\n${s.persona||''}\n\nThe user's name is ${s.myName||'user'}. User persona:\n${s.myPersona||''}\n\nThis is a private chat. Write only what ${s.realName} would actually send as a message. Do not explain your reasoning. Keep continuity with the conversation.`;
  const msgs=[{role:'system',content:system}];
  for(const m of history){
    if(!m?.content)continue;
    msgs.push({role:(m.role==='assistant'||m.role==='char')?'assistant':'user',content:String(m.content)});
  }
  msgs.push({role:'user',content:`[系统通知：距离上次互动已有一段时间。请以${s.realName}的身份判断此刻是否自然地想主动联系对方。如果适合联系，直接写要发送的消息；如果此刻不适合联系，只输出 <NO_MESSAGE>。]`});
  return msgs;
}

async function generate(snapshot, serverMessages){
  const provider=(process.env.AI_PROVIDER||'openai').toLowerCase();
  const base=(process.env.AI_BASE_URL||'').replace(/\/$/,'');
  const key=process.env.AI_API_KEY||''; const model=process.env.AI_MODEL||'';
  if(!base||!key||!model) throw new Error('AI env is incomplete');
  const messages=buildMessages(snapshot,serverMessages);
  if(provider==='gemini'){
    const contents=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
    contents.unshift({role:'user',parts:[{text:messages[0].content}]});
    const r=await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents,generationConfig:{temperature:Number(process.env.AI_TEMPERATURE||1)}})});
    if(!r.ok)throw new Error(`AI ${r.status}: ${await r.text()}`); const j=await r.json(); return j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
  }
  const r=await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model,messages,temperature:Number(process.env.AI_TEMPERATURE||1),stream:false})});
  if(!r.ok)throw new Error(`AI ${r.status}: ${await r.text()}`); const j=await r.json(); return j.choices?.[0]?.message?.content||'';
}

async function pushAll(payload){
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const r=await pool.query('SELECT endpoint,subscription FROM push_subscriptions');
  await Promise.allSettled(r.rows.map(async row=>{try{await webpush.sendNotification(row.subscription,JSON.stringify(payload));}catch(e){if(e.statusCode===404||e.statusCode===410)await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1',[row.endpoint]);else throw e;}}));
}

let ticking=false;
async function tick(){
  if(ticking)return; ticking=true;
  try{
    const now=Date.now();
    const due=await pool.query('SELECT * FROM characters WHERE next_due_at IS NOT NULL AND next_due_at <= $1 ORDER BY next_due_at ASC LIMIT 10',[now]);
    for(const row of due.rows){
      const s=row.snapshot; const ar=s.autoReply||{};
      if(!ar.enabled||s.isBlocked){await pool.query('UPDATE characters SET next_due_at=NULL WHERE id=$1',[row.id]);continue;}
      const extra=await pool.query('SELECT message FROM pending_messages WHERE character_id=$1 ORDER BY created_at ASC LIMIT 50',[row.id]);
      let text='';
      try{text=(await generate(s,extra.rows.map(x=>x.message))).trim();}catch(e){console.error('[AI]',row.id,e);await pool.query('UPDATE characters SET next_due_at=$2 WHERE id=$1',[row.id,now+15*60_000]);continue;}
      if(!text||/^<NO_MESSAGE>$/i.test(text)){
        // 角色这次“不想发”：15–45 分钟后再给一次随机判断机会，不等于固定发信。
        await pool.query('UPDATE characters SET next_due_at=$2 WHERE id=$1',[row.id,now+rand(15,45)*60_000]);
        continue;
      }
      const msg={id:`bg_${now}_${crypto.randomUUID()}`,role:'assistant',content:text,parts:[{type:'text',text}],timestamp:now,isBackground:true};
      await pool.query('INSERT INTO pending_messages(id,character_id,message,created_at) VALUES($1,$2,$3,$4)',[msg.id,row.id,msg,now]);
      const next=now+intervalMs(ar);
      await pool.query('UPDATE characters SET next_due_at=$2,last_generated_at=$3 WHERE id=$1',[row.id,next,now]);
      await pushAll({title:s.remarkName||s.realName||'UwU',body:text,icon:s.avatar||undefined,url:'./',characterId:row.id,messageId:msg.id});
    }
  }catch(e){console.error('[scheduler]',e);}finally{ticking=false;}
}

await ensureSchema();
app.listen(PORT,()=>console.log(`UwU background server listening on :${PORT}`));
setInterval(tick,INTERVAL); setTimeout(tick,3000);
