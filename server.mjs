import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from './worker-multi.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, '.data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const storage = {
  async get(key) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))[key]; }
    catch { return undefined; }
  },
  async put(key, value) {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
    all[key] = value;
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, DATA_FILE);
  },
  async setAlarm() {}
};
const game = new GameRoom({ storage });
await game.ready;

const SOCKET_SHIM = `class MorgdoniSocket{constructor(){this.events={};this.id=null;this.queue=[];this._hb=null;const p=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(p+'//'+location.host+'/ws');this.ws.onopen=()=>{this.emitLocal('connect');if(this._hb)clearInterval(this._hb);this._hb=setInterval(()=>{if(this.ws.readyState===1)this.ws.send(JSON.stringify({type:'heartbeat'}))},10000);for(const m of this.queue)this.ws.send(m);this.queue=[]};this.ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m?.type){if(m.type==='hello'&&m.data?.id){this.id=m.data.id;window.myId=m.data.id}this.emitLocal(m.type,m.data)}}catch(x){console.error(x)}};this.ws.onclose=()=>{clearInterval(this._hb);this._hb=null;this.emitLocal('disconnect')};this.ws.onerror=e=>this.emitLocal('connect_error',e)}on(e,c){(this.events[e]??=[]).push(c);return this}once(e,c){const f=d=>{this.off(e,f);c(d)};return this.on(e,f)}off(e,c){this.events[e]=(this.events[e]||[]).filter(x=>x!==c);return this}emit(e,d){const m=JSON.stringify({type:e,data:d??null});if(this.ws.readyState===1)this.ws.send(m);else this.queue.push(m);return this}emitLocal(e,d){for(const c of this.events[e]||[])try{c(d)}catch(x){console.error(x)}}disconnect(){clearInterval(this._hb);this._hb=null;this.ws?.close()}}window.io=window.io||function(){const s=new MorgdoniSocket();window.__MORG_SOCKET__=s;return s};`;
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.webp':'image/webp','.ico':'image/x-icon'};
function safePath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname); } catch { return null; }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(ROOT, '.' + pathname);
  return target.startsWith(ROOT + path.sep) ? target : null;
}
const server = http.createServer((req,res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') { res.writeHead(200, {'content-type':'text/plain; charset=utf-8'}); return res.end('ok'); }
  if (url.pathname === '/socket.io/socket.io.js') { res.writeHead(200, {'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'}); return res.end(SOCKET_SHIM); }
  const file = safePath(req.url || '/');
  if (!file) { res.writeHead(400); return res.end('Bad request'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); return res.end('Not Found'); }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      let html = fs.readFileSync(file, 'utf8');
      if (!/socket\.io\/socket\.io\.js/i.test(html)) html = html.replace(/<\/head>/i, '<script src="/socket.io/socket.io.js"></script></head>');
      const scripts = ['morgdoni-card-fix.js','request-ui.js','lobby-fix.js'];
      const missing = scripts.filter(s => !new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(html));
      if (missing.length) html = html.replace(/<\/body>/i, missing.map(s => `<script src="/${s}"></script>`).join('') + '</body>');
      res.writeHead(200, {'content-type':MIME[ext], 'cache-control':'no-store'}); return res.end(html);
    }
    res.writeHead(200, {'content-type':MIME[ext] || 'application/octet-stream', 'x-content-type-options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch { socket.destroy(); return; }
  if (pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  const id = crypto.randomUUID();
  const session = { get readyState(){return ws.readyState;}, send(data){ if (ws.readyState === 1) ws.send(data); } };
  game.sessions.set(id, session);
  game.send(id, 'hello', { id });
  ws.on('message', raw => { game.message(id, raw.toString()).catch(err => { console.error('message handler:', err); game.send(id,'error','خطای داخلی سرور'); }); });
  ws.on('close', () => { game.close(id).catch(err => console.error('disconnect handler:', err)); });
  ws.on('error', err => console.error('websocket:', err.message));
});
server.listen(PORT, '0.0.0.0', () => console.log(`مرغ‌دونی روی پورت ${PORT} اجرا شد`));
function shutdown(){ for(const c of wss.clients)c.close(); server.close(()=>process.exit(0)); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
