import fs from "node:fs";
import tls from "node:tls";

const API = (process.env.CLOUD_MAIL_API_URL || "https://mail.12310721.xyz/api/v1").replace(/\/+$/,"");
const CERT = process.env.TLS_CERT_FILE || "/certs/fullchain.pem";
const KEY = process.env.TLS_KEY_FILE || "/certs/privkey.pem";
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const POP3_PORT = Number(process.env.POP3_PORT || 995);
const MAX_MESSAGES = 500;

async function api(path, key, options={}) {
  const response = await fetch(API + path, {
    ...options,
    headers: { ...(key ? { authorization: "Bearer " + key } : {}), ...(options.body ? { "content-type":"application/json" } : {}), ...(options.headers||{}) }
  });
  if (!response.ok) {
    const body = await response.text().catch(()=> "");
    throw new Error("Cloud Mail API " + response.status + ": " + body.slice(0,200));
  }
  return response;
}
async function protocols() {
  const r = await api("/protocols");
  return (await r.json()).data;
}
async function authenticate(email,password) {
  const r = await api("/me",password);
  const me=(await r.json()).data;
  if (email && email.toLowerCase() !== me.email.toLowerCase()) throw new Error("Mailbox username does not match API key");
  return me;
}
async function messages(key) {
  const r=await api("/mail?limit="+MAX_MESSAGES+"&offset=0&includeDeleted=1&sort=asc",key);
  return (await r.json()).data;
}
async function rawMessage(key,id) {
  const r=await api("/mail/"+encodeURIComponent(id)+"/raw",key);
  return Buffer.from(await r.arrayBuffer());
}
async function patch(key,id,body) {
  await api("/mail/"+encodeURIComponent(id),key,{method:"PATCH",body:JSON.stringify(body)});
}
async function expunge(key) {
  await api("/mail/expunge",key,{method:"POST",body:"{}"});
}
function write(socket,line){socket.write(line+"\r\n")}
function words(input){const out=[];const re=/"((?:\\.|[^"])*)"|(\S+)/g;let m;while((m=re.exec(input))!==null)out.push(m[1]!==undefined?m[1].replace(/\\"/g,'"').replace(/\\\\/g,"\\"):m[2]);return out}
function flags(m){const f=[];if(m.is_read)f.push("\\Seen");if(m.is_deleted)f.push("\\Deleted");return "("+f.join(" ")+")"}
function sequenceNumbers(set,count){const found=new Set();for(const part of String(set).split(",")){const pair=part.split(":");let a=pair[0]==="*"?count:Number(pair[0]),b=(pair[1]||pair[0])==="*"?count:Number(pair[1]||pair[0]);if(!Number.isFinite(a)||!Number.isFinite(b))continue;for(let n=Math.min(a,b);n<=Math.max(a,b)&&n<=count;n++)if(n>=1)found.add(n)}return [...found].sort((a,b)=>a-b)}
function imap(socket,enabled) {
  let buffer="",queue=Promise.resolve(),key="",user="",mailbox=null,selected=false,authPending=false,authTag="";
  write(socket,enabled?"* OK Cloud Mail IMAP4rev1 ready":"* BYE IMAP is disabled by administrator");
  if(!enabled){socket.end();return}
  async function refresh(){mailbox=await messages(key);return mailbox}
  async function handle(line){
    const first=line.indexOf(" ");if(first<0){write(socket,"* BAD Invalid command");return}
    const tag=line.slice(0,first),rest=line.slice(first+1),space=rest.indexOf(" "),command=(space<0?rest:rest.slice(0,space)).toUpperCase(),args=space<0?"":rest.slice(space+1),a=words(args);
    try{
      if(authPending){authPending=false;const decoded=Buffer.from(line.trim(),"base64").toString("utf8").split("\0");user=decoded[1]||"";key=decoded[2]||"";await authenticate(user,key);write(socket,authTag+" OK AUTHENTICATE completed");authTag="";return}
      if(command==="CAPABILITY"){write(socket,"* CAPABILITY IMAP4rev1 UIDPLUS AUTH=PLAIN");write(socket,tag+" OK CAPABILITY completed");return}
      if(command==="AUTHENTICATE"&&a[0]?.toUpperCase()==="PLAIN"){authTag=tag;if(a[1]){const decoded=Buffer.from(a[1],"base64").toString("utf8").split("\0");user=decoded[1]||"";key=decoded[2]||"";await authenticate(user,key);write(socket,tag+" OK AUTHENTICATE completed")}else{authPending=true;write(socket,"+")}return}
      if(command==="NOOP"){write(socket,tag+" OK NOOP completed");return}
      if(command==="LOGOUT"){write(socket,"* BYE Logging out");write(socket,tag+" OK LOGOUT completed");socket.end();return}
      if(command==="LOGIN"){if(a.length<2){write(socket,tag+" BAD LOGIN requires username and password");return}user=a[0];key=a[1];await authenticate(user,key);write(socket,tag+" OK LOGIN completed");return}
      if(!key){write(socket,tag+" NO Authenticate first");return}
      if(command==="LIST"||command==="LSUB"){write(socket,'* LIST (\\HasNoChildren) "/" "INBOX"');write(socket,tag+" OK LIST completed");return}
      if(command==="NAMESPACE"){write(socket,'* NAMESPACE (("" "/")) NIL NIL');write(socket,tag+" OK NAMESPACE completed");return}
      if(command==="STATUS"){const rows=await refresh();const unseen=rows.filter(x=>!x.is_read&&!x.is_deleted).length;const uidnext=Math.max(0,...rows.map(x=>Number(x.protocol_uid)||0))+1;write(socket,"* STATUS INBOX (MESSAGES "+rows.filter(x=>!x.is_deleted).length+" UNSEEN "+unseen+" UIDNEXT "+uidnext+" UIDVALIDITY 1)");write(socket,tag+" OK STATUS completed");return}
      if(command==="SELECT"||command==="EXAMINE"){await refresh();selected=true;const active=mailbox.filter(x=>!x.is_deleted);const unseen=active.filter(x=>!x.is_read).length;const uidnext=Math.max(0,...mailbox.map(x=>Number(x.protocol_uid)||0))+1;write(socket,"* FLAGS (\\Seen \\Deleted)");write(socket,"* "+active.length+" EXISTS");write(socket,"* "+unseen+" RECENT");write(socket,"* OK [UIDVALIDITY 1] stable UIDs");write(socket,"* OK [UIDNEXT "+uidnext+"] predicted next UID");write(socket,"* OK [PERMANENTFLAGS (\\Seen \\Deleted)]");write(socket,tag+" OK ["+(command==="EXAMINE"?"READ-ONLY":"READ-WRITE")+"] "+command+" completed");return}
      if(command==="CLOSE"){if(selected){await expunge(key);await refresh();selected=false}write(socket,tag+" OK CLOSE completed");return}
      if(command==="CHECK"){write(socket,tag+" OK CHECK completed");return}
      if(command==="EXPUNGE"){if(!selected){write(socket,tag+" NO Select a mailbox first");return}await refresh();let seq=0;for(const m of mailbox){if(!m.is_deleted){seq++;continue}write(socket,"* "+(seq+1)+" EXPUNGE")}await expunge(key);await refresh();write(socket,tag+" OK EXPUNGE completed");return}
      if(command==="SEARCH"||command==="UID"){let uidMode=false,sub=args;if(command==="UID"){const p=args.indexOf(" ");const subcmd=(p<0?args:args.slice(0,p)).toUpperCase();sub=args.slice(p+1);uidMode=true;if(subcmd!=="SEARCH"){if(subcmd==="FETCH"){await doFetch(tag,sub,true);return}if(subcmd==="STORE"){await doStore(tag,sub,true);return}write(socket,tag+" BAD Unsupported UID command");return}}
        if(!selected){write(socket,tag+" NO Select a mailbox first");return}await refresh();const terms=sub.toUpperCase().split(/\s+/);let rows=mailbox.filter(x=>!x.is_deleted);if(terms.includes("UNSEEN"))rows=rows.filter(x=>!x.is_read);if(terms.includes("SEEN"))rows=rows.filter(x=>!!x.is_read);if(terms.includes("DELETED"))rows=mailbox.filter(x=>!!x.is_deleted);if(terms.includes("UNDELETED"))rows=rows.filter(x=>!x.is_deleted);const nums=rows.map(x=>uidMode?x.protocol_uid:mailbox.indexOf(x)+1);write(socket,"* SEARCH "+nums.join(" "));write(socket,tag+" OK SEARCH completed");return}
      if(command==="FETCH"){await doFetch(tag,args,false);return}
      if(command==="STORE"){await doStore(tag,args,false);return}
      if(command==="APPEND"){write(socket,tag+" NO APPEND is not supported by this mailbox service");return}
      if(command==="IDLE"){write(socket,tag+" NO IDLE is not supported; use NOOP or refresh");return}
      write(socket,tag+" BAD Unsupported command");
    }catch(e){write(socket,tag+" NO "+String(e.message||e).replace(/[\r\n]/g," ").slice(0,180))}
  }
  async function doFetch(tag,args,uidMode){
    if(!selected){write(socket,tag+" NO Select a mailbox first");return}
    const p=args.indexOf(" ");if(p<0){write(socket,tag+" BAD FETCH syntax");return}
    const set=args.slice(0,p),items=args.slice(p+1),all=await refresh(),selectedRows=all.filter(x=>!x.is_deleted),numbers=sequenceNumbers(set,uidMode?all.length:selectedRows.length);
    for(const n of numbers){const m=uidMode?all.find(x=>Number(x.protocol_uid)===n):selectedRows[n-1];if(!m)continue;const seq=selectedRows.indexOf(m)+1,raw=await rawMessage(key,m.id),peek=/BODY\.PEEK/i.test(items),f=flags(m);write(socket,"* "+seq+" FETCH (UID "+m.protocol_uid+" FLAGS "+f+" RFC822.SIZE "+raw.length+" BODY[] {"+raw.length+"}");socket.write(raw);socket.write(Buffer.from("\r\n)\r\n"));if(!peek&&!m.is_read)await patch(key,m.id,{is_read:true})}
    write(socket,tag+" OK FETCH completed");
  }
  async function doStore(tag,args,uidMode){
    if(!selected){write(socket,tag+" NO Select a mailbox first");return}
    const p=args.indexOf(" ");if(p<0){write(socket,tag+" BAD STORE syntax");return}
    const set=args.slice(0,p),rest=args.slice(p+1),match=rest.match(/^([+-]?FLAGS(?:\.SILENT)?)\s+(.+)$/i);if(!match){write(socket,tag+" BAD STORE flags syntax");return}
    const mode=match[1].toUpperCase(),flagText=match[2],wantSeen=/\\Seen/i.test(flagText),wantDeleted=/\\Deleted/i.test(flagText),all=await refresh(),selectedRows=all.filter(x=>!x.is_deleted),nums=sequenceNumbers(set,uidMode?all.length:selectedRows.length);
    for(const n of nums){const m=uidMode?all.find(x=>Number(x.protocol_uid)===n):selectedRows[n-1];if(!m)continue;const body={};if(mode.startsWith("+")){if(wantSeen)body.is_read=true;if(wantDeleted)body.is_deleted=true}else if(mode.startsWith("-")){if(wantSeen)body.is_read=false;if(wantDeleted)body.is_deleted=false}else{body.is_read=wantSeen;body.is_deleted=wantDeleted}await patch(key,m.id,body);if(!mode.endsWith(".SILENT")){const fresh={...m,is_read:body.is_read??m.is_read,is_deleted:body.is_deleted??m.is_deleted};write(socket,"* "+(selectedRows.indexOf(m)+1)+" FETCH (UID "+m.protocol_uid+" FLAGS "+flags(fresh)+")")}}
    write(socket,tag+" OK STORE completed");
  }
  socket.on("data",chunk=>{buffer+=chunk.toString("utf8");let i;while((i=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,i).replace(/\r$/,"");buffer=buffer.slice(i+1);queue=queue.then(()=>handle(line)).catch(e=>write(socket,"* BYE "+String(e.message||e).slice(0,160)))}});socket.on("error",()=>{});
}
function pop3(socket,enabled){
  let buffer="",queue=Promise.resolve(),key="",user="",mailbox=[],deleted=new Set(),authenticated=false;
  write(socket,enabled?"+OK Cloud Mail POP3 ready":"-ERR POP3 is disabled by administrator");if(!enabled){socket.end();return}
  async function refresh(){mailbox=await messages(key);return mailbox.filter(x=>!x.is_deleted&&!deleted.has(x.id))}
  async function handle(line){
    const p=line.indexOf(" "),command=(p<0?line:line.slice(0,p)).toUpperCase(),arg=p<0?"":line.slice(p+1).trim();
    try{
      if(command==="CAPA"){write(socket,"+OK Capability list follows");write(socket,"USER");write(socket,"UIDL");write(socket,"TOP");write(socket,".");return}
      if(command==="QUIT"){if(authenticated){for(const mid of deleted)await patch(key,mid,{is_deleted:true});await expunge(key)}write(socket,"+OK Goodbye");socket.end();return}
      if(command==="USER"){user=arg;write(socket,"+OK User accepted");return}
      if(command==="PASS"){if(!user||!arg){write(socket,"-ERR USER is required first");return}key=arg;await authenticate(user,key);authenticated=true;await refresh();write(socket,"+OK Mailbox locked and ready ("+mailbox.length+" messages)");return}
      if(!authenticated){write(socket,"-ERR Authenticate first");return}
      if(command==="NOOP"){write(socket,"+OK");return}
      if(command==="RSET"){deleted.clear();await refresh();write(socket,"+OK deletion marks cleared");return}
      if(command==="STAT"){const rows=await refresh();const size=rows.reduce((n,m)=>n+Number(m.size_bytes||0),0);write(socket,"+OK "+rows.length+" "+size);return}
      if(command==="LIST"||command==="UIDL"){const rows=await refresh();if(arg){const n=Number(arg),m=rows[n-1];if(!m){write(socket,"-ERR no such message");return}write(socket,command==="LIST"?"+OK "+n+" "+m.size_bytes:"+OK "+n+" "+m.protocol_uid);return}write(socket,"+OK "+(command==="LIST"?"Message sizes":"Unique-ID listing")+" follows");rows.forEach((m,i)=>write(socket,(i+1)+" "+(command==="LIST"?m.size_bytes:m.protocol_uid)));write(socket,".");return}
      if(command==="DELE"){const n=Number(arg),rows=await refresh(),m=rows[n-1];if(!m){write(socket,"-ERR no such message");return}deleted.add(m.id);write(socket,"+OK message "+n+" marked for deletion");return}
      if(command==="RETR"||command==="TOP"){const bits=arg.split(/\s+/),n=Number(bits[0]),rows=await refresh(),m=rows[n-1];if(!m){write(socket,"-ERR no such message");return}const raw=await rawMessage(key,m.id);let data=raw.toString("utf8");if(command==="TOP"){const count=Math.max(0,Number(bits[1]||0));const parts=data.split(/\r?\n\r?\n/);data=parts[0]+"\r\n\r\n"+(parts.slice(1).join("\r\n\r\n").split(/\r?\n/).slice(0,count).join("\r\n"))}const lines=data.replace(/\r?\n/g,"\r\n").split("\r\n").map(x=>x.startsWith(".")?"."+x:x);write(socket,"+OK "+raw.length+" octets");socket.write(lines.join("\r\n")+"\r\n.\r\n");return}
      write(socket,"-ERR unsupported command");
    }catch(e){write(socket,"-ERR "+String(e.message||e).replace(/[\r\n]/g," ").slice(0,180))}
  }
  socket.on("data",chunk=>{buffer+=chunk.toString("utf8");let i;while((i=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,i).replace(/\r$/,"");buffer=buffer.slice(i+1);queue=queue.then(()=>handle(line)).catch(e=>write(socket,"-ERR "+String(e.message||e).slice(0,160)))}});socket.on("error",()=>{});
}
const cert=fs.readFileSync(CERT),key=fs.readFileSync(KEY);
function createServer(port,kind){const server=tls.createServer({cert,key,minVersion:"TLSv1.2"},async socket=>{try{const cfg=await protocols();if(kind==="imap")imap(socket,!!cfg.imapEnabled);else pop3(socket,!!cfg.pop3Enabled)}catch(e){write(socket,"-ERR Cloud Mail backend unavailable");socket.end()}});server.listen(port,"0.0.0.0",()=>console.log(kind.toUpperCase()+" listening on "+port));server.on("error",e=>{console.error(kind+" server error",e);process.exitCode=1})}
createServer(IMAP_PORT,"imap");
createServer(POP3_PORT,"pop3");
