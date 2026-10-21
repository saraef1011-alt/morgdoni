import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { GameRoom } from './worker-entry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = path.join(__dirname, 'morgdoni-data.json');

async function readData() {
  try { return JSON.parse(await fs.readFile(DB_FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
let writeChain = Promise.resolve();
const storage = {
  async get(key) { return (await readData())[key]; },
  async put(key, value) {
    writeChain = writeChain.then(async () => {
      const data = await readData();
      data[key] = value;
      const tmp = DB_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fs.rename(tmp, DB_FILE);
    });
    return writeChain;
  },
  async setAlarm() {}
};
const game = new GameRoom({ storage });
await game.ready;

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/socket.io/socket.io.js', async (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store')
    .send(await fs.readFile(path.join(__dirname, 'socket-shim.js'), 'utf8'));
});
app.use(async (req, res, next) => {
  if (!['/', '/index.html', '/vs.html'].includes(req.path)) return next();
  try {
    const file = req.path === '/' ? 'index.html' : req.path.slice(1);
    let html = await fs.readFile(path.join(__dirname, file), 'utf8');
    html = html.replace(/<script[^>]+(?:request-ui|lobby-fix|morgdoni-card-fix|online-panel)[^>]*><\\/script>/gi, '');
    if (!/socket\\.io\\/socket\\.io\\.js/i.test(html)) {
      html = html.replace(/<\\/head>/i, '<script src="/socket.io/socket.io.js"></script></head>');
    }
    const scripts = '<script src="/morgdoni-card-fix.js"></script><script src="/request-ui.js"></script><script src="/lobby-fix.js"></script><script src="/online-panel.js"></script></body>';
    html = html.replace(/<\\/body>/i, scripts);
    res.type('html').set('Cache-Control', 'no-store').send(html);
  } catch (err) { next(err); }
});
app.use(express.static(__dirname));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  const id = randomUUID();
  game.sessions.set(id, ws);
  game.send(id, 'hello', { id });
  ws.on('message', raw => game.message(id, raw.toString()).catch(err => console.error('message:', err)));
  ws.on('close', () => game.close(id).catch(err => console.error('disconnect:', err)));
  ws.on('error', err => console.error('WebSocket:', err.message));
});
server.listen(PORT, '0.0.0.0', () => console.log(`مرغ‌دونی آماده است روی پورت ${PORT}`));
