import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import WebSocket from 'ws';

async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(err => err ? reject(err) : resolve(port));
    });
  });
}
async function waitFor(url, child, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error('server.mjs exited before becoming ready');
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become ready in time');
}
test('Node server serves health, game HTML and a WebSocket hello event', async t => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', b => logs += b);
  child.stderr.on('data', b => logs += b);
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const base = 'http://127.0.0.1:' + port;
  const health = await waitFor(base + '/healthz', child);
  assert.equal((await health.text()).trim(), 'ok');
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /مرغ/);
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  t.after(() => { if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(); });
  const hello = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket hello timeout')), 4000);
    socket.once('message', data => { clearTimeout(timeout); try { resolve(JSON.parse(data.toString())); } catch (e) { reject(e); } });
    socket.once('error', e => { clearTimeout(timeout); reject(e); });
  });
  assert.equal(hello.type, 'hello');
  assert.ok(hello.data && typeof hello.data.id === 'string');
}, { timeout: 15000 });
