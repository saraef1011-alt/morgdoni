import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom as MultiGameRoom } from './worker-multi.js';
import { cleanupDisconnectedPlayer } from './presence-cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'morgdoni-node-data.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return null; }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('data save error:', e.message);
  }
}

const stored = readData();
const state = {
  storage: {
    async get(key) {
      if (key !== 'data') return undefined;
      const data = stored ?? readData();
      return data ? JSON.parse(JSON.stringify(data)) : undefined;
    },
    async put(key, value) {
      if (key === 'data') writeData(value);
    },
    async setAlarm() {}
  }
};

class NodeGameRoom extends MultiGameRoom {
  async close(id) {
    await cleanupDisconnectedPlayer(this, id);
  }
}

const room = new NodeGameRoom(state);
await room.ready;

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

app.get('/socket.io/socket.io.js', (_req, res) => {
  res.type('application/javascript').send(`class MorgdoniSocket{constructor(){this.events={};this.id=null;this.queue=[];const p=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(p+'//'+location.host+'/ws');this.ws.onopen=()=>{this.emitLocal('connect');for(const m of this.queue)this.ws.send(m);this.queue=[]};this.ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m?.type){if(m.type==='hello'&&m.data?.id){this.id=m.data.id;window.myId=m.data.id}this.emitLocal(m.type,m.data)}}catch(x){console.error(x)}};this.ws.onclose=()=>this.emitLocal('disconnect');this.ws.onerror=e=>this.emitLocal('connect_error',e)}on(e,c){(this.events[e]??=[]).push(c);return this}once(e,c){const f=d=>{this.off(e,f);c(d)};return this.on(e,f)}off(e,c){this.events[e]=(this.events[e]||[]).filter(x=>x!==c);return this}emit(e,d){const m=JSON.stringify({type:e,data:d??null});if(this.ws.readyState===1)this.ws.send(m);else this.queue.push(m);return this}emitLocal(e,d){for(const c of this.events[e]||[])try{c(d)}catch(x){console.error(x)}}disconnect(){this.ws?.close()}}window.io=window.io||function(){const s=new MorgdoniSocket();window.__MORG_SOCKET__=s;return s};`);
});

app.use(express.static(__dirname, { extensions: ['html'] }));
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  res.status(404).send('Not Found');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://' + request.headers.host);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', async ws => {
  await room.ready;
  const id = randomUUID();
  room.sessions.set(id, ws);
  room.send(id, 'hello', { id });

  ws.on('message', raw => {
    Promise.resolve(room.message(id, raw.toString())).catch(err => {
      console.error('message error:', err);
      room.send(id, 'error', 'خطای سرور');
    });
  });

  ws.on('close', () => {
    Promise.resolve(room.close(id)).catch(err => console.error('close error:', err));
    room.sessions.delete(id);
  });

  ws.on('error', err => console.error('websocket error:', err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Morgdoni Node.js server running on port ${PORT}`);
});
