import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { GameRoom } from "./worker-multi.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const dataFile = path.join(root, "data.json");

class NodeStorage {
  async get(key) {
    try { return JSON.parse(fs.readFileSync(dataFile, "utf8"))[key]; }
    catch (e) { if (e.code === "ENOENT" || e instanceof SyntaxError) return undefined; throw e; }
  }
  async put(key, value) {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch {}
    all[key] = value;
    const tmp = dataFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
    fs.renameSync(tmp, dataFile);
  }
  async setAlarm() {}
}
const game = new GameRoom({ storage: new NodeStorage() });
await game.ready;

const socketShim = `class MorgdoniSocket {
  constructor(){this.events={};this.id=null;this.queue=[];const p=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(p+'//'+location.host+'/ws');
    this.ws.onopen=()=>{this.emitLocal('connect');for(const m of this.queue)this.ws.send(m);this.queue=[]};
    this.ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m?.type){if(m.type==='hello'&&m.data?.id){this.id=m.data.id;window.myId=m.data.id}this.emitLocal(m.type,m.data)}}catch(err){console.error(err)}};
    this.ws.onclose=()=>this.emitLocal('disconnect');this.ws.onerror=e=>this.emitLocal('connect_error',e);
    this._hb=setInterval(()=>{if(this.ws.readyState===1)this.ws.send(JSON.stringify({type:'heartbeat',data:{}}))},10000)}
  on(e,c){(this.events[e]??=[]).push(c);return this} once(e,c){const f=d=>{this.off(e,f);c(d)};return this.on(e,f)}
  off(e,c){this.events[e]=(this.events[e]||[]).filter(x=>x!==c);return this}
  emit(e,d){const m=JSON.stringify({type:e,data:d??null});if(this.ws.readyState===1)this.ws.send(m);else this.queue.push(m);return this}
  emitLocal(e,d){for(const c of this.events[e]||[])try{c(d)}catch(err){console.error(err)}}
  disconnect(){clearInterval(this._hb);this.ws.close()}
}
window.io=window.io||function(){const s=new MorgdoniSocket();window.__MORG_SOCKET__=s;return s};`;

const mime = file => ({
  ".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",
  ".mp3":"audio/mpeg",".wav":"audio/wav",".ogg":"audio/ogg",".ico":"image/x-icon",
  ".webp":"image/webp"
}[path.extname(file).toLowerCase()] || "application/octet-stream");

const server = http.createServer((req,res)=>{
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if(url.pathname==="/healthz"){res.writeHead(200,{"content-type":"text/plain; charset=utf-8"});res.end("ok");return}
  if(url.pathname==="/socket.io/socket.io.js"){res.writeHead(200,{"content-type":"application/javascript; charset=utf-8","cache-control":"no-store"});res.end(socketShim);return}
  let requested;
  try { requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); }
  catch { res.writeHead(400);res.end("Bad request");return; }
  const full = path.resolve(root, "." + requested);
  if(full !== root && !full.startsWith(root + path.sep)){res.writeHead(403);res.end("Forbidden");return}
  fs.readFile(full,(err,buf)=>{
    if(err){res.writeHead(err.code==="ENOENT"?404:500,{"content-type":"text/plain; charset=utf-8"});res.end(err.code==="ENOENT"?"Not Found":"Server error");return}
    let body=buf;
    if(path.basename(full)==="index.html"){
      let html=buf.toString("utf8");
      if(!/socket\.io\/socket\.io\.js/i.test(html))html=html.replace(/<\/head>/i,'<script src="/socket.io/socket.io.js"></script></head>');
      for(const f of ["morgdoni-card-fix.js","request-ui.js","lobby-fix.js","online-panel.js"]){
        if(!html.includes(f))html=html.replace(/<\/body>/i,`<script src="/${f}?v=nodejs"></script></body>`);
      }
      body=Buffer.from(html);
    }
    res.writeHead(200,{"content-type":mime(full),"content-length":body.length,"cache-control":path.extname(full)===".html"?"no-store":"public, max-age=3600"});res.end(body);
  });
});

const wss = new WebSocketServer({noServer:true,maxPayload:8*1024*1024});
server.on("upgrade",(req,socket,head)=>{
  const pathname=new URL(req.url || "/",`http://${req.headers.host || "localhost"}`).pathname;
  if(pathname!=="/ws"){socket.destroy();return}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));
});
wss.on("connection",ws=>{
  const id=randomUUID();game.sessions.set(id,ws);game.send(id,"hello",{id});
  ws.on("message",raw=>Promise.resolve(game.message(id,raw.toString("utf8"))).catch(err=>{console.error("Game message:",err);game.send(id,"error","خطای داخلی سرور")}));
  ws.on("close",()=>Promise.resolve(game.close(id)).catch(err=>console.error("Disconnect:",err)));
  ws.on("error",err=>console.error("WebSocket:",err.message));
});
setInterval(()=>Promise.resolve(game.alarm()).catch(err=>console.error("Presence cleanup:",err)),15000).unref();
server.listen(port,host,()=>console.log(`مرغ‌دونی Node.js آماده است: http://localhost:${port}`));
process.on("SIGINT",()=>{wss.close();server.close(()=>process.exit(0))});
