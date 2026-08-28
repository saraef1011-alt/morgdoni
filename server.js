const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 10 * 1024 * 1024,
  cors: { origin: true, credentials: true }
});

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const profilesFile = path.join(ROOT, 'profiles.json');

// Render needs the application to answer HTTP requests immediately.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health endpoint for Render and for quick server checks.
app.get('/healthz', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

app.use('/assets', express.static(path.join(PUBLIC, 'assets'), { maxAge: '7d' }));
app.use(express.static(PUBLIC));
app.use(express.static(ROOT));

app.get('/', (req, res) => {
  try {
    const indexFile = path.join(ROOT, 'index.html');
    if (!fs.existsSync(indexFile)) {
      return res.status(404).send('index.html پیدا نشد');
    }

    let html = fs.readFileSync(indexFile, 'utf8');
    const fixFile = path.join(ROOT, 'morgdoni-fix.js');

    if (fs.existsSync(fixFile) && !html.includes('/morgdoni-fix.js')) {
      html = html.replace(
        '</body>',
        '<script src="/morgdoni-fix.js?v=5"></script></body>'
      );
    }

    res.status(200).type('html').send(html);
  } catch (err) {
    console.error('Root page error:', err);
    res.status(500).send('خطا در بارگذاری بازی');
  }
});

let profiles = {};
try {
  if (fs.existsSync(profilesFile)) {
    profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
  }
} catch (err) {
  console.error('Profiles load error:', err.message);
  profiles = {};
}

const save = () => {
  try {
    fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
  } catch (err) {
    console.error('Profiles save error:', err.message);
  }
};

const online = new Map();
const rooms = {};

const profile = (id, name = 'بازیکن', avatar = '🐔') =>
  profiles[id] || (profiles[id] = {
    accountId: id,
    username: name,
    avatar,
    gamesPlayed: 0,
    wins: 0,
    losses: 0
  });

const broadcast = () => {
  io.emit(
    'playerListUpdate',
    [...online].map(([id, p]) => ({ id, ...p }))
  );
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deck() {
  const d = [];
  for (let i = 0; i < 21; i++) d.push('مرغ');
  for (let i = 0; i < 21; i++) d.push('خروس');
  for (let i = 0; i < 12; i++) d.push('لانه');
  for (let i = 0; i < 7; i++) d.push('روباه');
  for (let i = 0; i < 3; i++) d.push('تله');
  for (let i = 0; i < 2; i++) d.push('مار');
  return shuffle(d);
}

function newRoom(ps) {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const r = {
    host: ps[0].id,
    players: ps.map(p => ({ ...p, hand: [], eggs: 0, chicks: 0 })),
    gameStarted: true,
    deck: deck(),
    eggTokens: 18,
    currentTurn: null,
    winner: null,
    discardPile: []
  };

  for (const p of r.players) {
    for (let i = 0; i < 4; i++) {
      if (r.deck.length) p.hand.push(r.deck.pop());
    }
  }

  r.currentTurn = r.players[0].id;
  rooms[id] = r;

  ps.forEach(p => {
    const o = online.get(p.id);
    if (o) o.status = 'playing';
    io.to(p.id).emit('gameStarted', { roomId: id });
  });

  broadcast();
  io.to(id).emit('gameState', r);
  return id;
}

function leaveRoom(sid) {
  for (const id of Object.keys(rooms)) {
    const r = rooms[id];
    const i = r.players.findIndex(p => p.id === sid);
    if (i < 0) continue;

    r.players.splice(i, 1);

    if (!r.players.length) {
      delete rooms[id];
    } else {
      r.host = r.players[0].id;
      r.currentTurn = r.players[0].id;
      io.to(id).emit('roomUpdate', r);
    }
  }
}

function finish(r) {
  if (!r.winner) {
    const w = r.players.find(p => p.chicks >= 3);
    if (w) r.winner = w.id;
  }

  if (!r.winner) return;

  r.players.forEach(p => {
    const q = profiles[p.accountId];
    if (!q) return;
    q.gamesPlayed++;
    p.id === r.winner ? q.wins++ : q.losses++;
  });

  save();
}

io.on('connection', s => {
  s.on('loadProfile', ({ accountId }) =>
    s.emit('profileData', { profile: profiles[accountId] || null })
  );

  s.on('saveProfile', ({ accountId, username, avatar }) => {
    if (!accountId || !username || username.trim().length < 2) {
      return s.emit('profileError', 'نام کاربری معتبر نیست');
    }

    const p = profile(accountId);
    p.username = username.trim();
    p.avatar = avatar || p.avatar;
    save();
    s.emit('profileData', { profile: p });

    const o = online.get(s.id);
    if (o) {
      o.name = p.username;
      o.avatar = p.avatar;
      broadcast();
    }
  });

  s.on('getProfile', ({ targetId }) => {
    const o = online.get(targetId);
    if (!o) return s.emit('profileInfoError', 'بازیکن آنلاین نیست');

    const p = profile(o.accountId, o.name, o.avatar);
    s.emit('profileInfo', {
      name: p.username,
      avatar: p.avatar,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      losses: p.losses
    });
  });

  s.on('registerPlayer', ({ playerName, accountId, avatar }) => {
    const p = profile(accountId, playerName, avatar);
    online.set(s.id, {
      name: p.username,
      accountId,
      avatar: p.avatar,
      status: 'ready'
    });
    s.emit('registrationSuccess', { id: s.id, name: p.username });
    broadcast();
  });

  s.on('requestGame', ({ targetId }) => {
    const a = online.get(s.id);
    const b = online.get(targetId);
    if (!b || b.status !== 'ready') {
      return s.emit('gameRequestError', 'این بازیکن آماده نیست');
    }
    a.status = 'requesting';
    b.status = 'requested';
    io.to(targetId).emit('gameRequest', {
      fromId: s.id,
      fromName: a.name
    });
    broadcast();
  });

  s.on('acceptGame', ({ fromId }) => {
    const a = online.get(fromId);
    const b = online.get(s.id);
    if (!a || !b) return s.emit('gameError', 'بازیکن دیگر آنلاین نیست');
    newRoom([
      { id: fromId, name: a.name, accountId: a.accountId, avatar: a.avatar },
      { id: s.id, name: b.name, accountId: b.accountId, avatar: b.avatar }
    ]);
  });

  s.on('rejectGame', ({ fromId }) => {
    const a = online.get(fromId);
    const b = online.get(s.id);
    if (a) a.status = 'ready';
    if (b) b.status = 'ready';
    io.to(fromId).emit('gameRejected', { byName: b?.name || 'حریف' });
    broadcast();
  });

  s.on('quickGame', () => {
    const me = online.get(s.id);
    const other = [...online.entries()].find(
      ([id, p]) => id !== s.id && p.status === 'ready'
    );
    if (!me) return s.emit('quickGameError', 'ابتدا وارد لابی شو');
    if (!other) return s.emit('quickGameError', 'منتظر بازیکن دیگری بمان...');

    newRoom([
      { id: s.id, name: me.name, accountId: me.accountId, avatar: me.avatar },
      {
        id: other[0],
        name: other[1].name,
        accountId: other[1].accountId,
        avatar: other[1].avatar
      }
    ]);
  });

  s.on('createRoom', ({ roomId, playerName }) => {
    if (rooms[roomId]) return s.emit('roomError', 'اتاق قبلاً وجود دارد');
    const o = online.get(s.id);
    rooms[roomId] = {
      host: s.id,
      players: [{
        id: s.id,
        name: playerName,
        accountId: o?.accountId,
        avatar: o?.avatar || '🐔'
      }],
      gameStarted: false,
      deck: deck(),
      eggTokens: 18,
      currentTurn: null,
      winner: null,
      discardPile: []
    };
    s.join(roomId);
    s.emit('roomCreated', { roomId });
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  s.on('joinRoom', ({ roomId, playerName }) => {
    const r = rooms[roomId];
    if (!r) return s.emit('roomError', 'اتاق پیدا نشد');
    const o = online.get(s.id);
    s.join(roomId);
    r.players.push({
      id: s.id,
      name: playerName,
      accountId: o?.accountId,
      avatar: o?.avatar || '🐔'
    });
    io.to(roomId).emit('roomUpdate', r);
  });

  s.on('startGame', ({ roomId }) => {
    const r = rooms[roomId];
    if (!r || r.host !== s.id || r.players.length < 2) return;
    r.gameStarted = true;
    r.deck = deck();
    r.players.forEach(p => {
      p.hand = [];
      p.eggs = 0;
      p.chicks = 0;
      for (let i = 0; i < 4; i++) {
        if (r.deck.length) p.hand.push(r.deck.pop());
      }
    });
    r.currentTurn = r.players[0].id;
    io.to(roomId).emit('gameState', r);
  });

  s.on('getGameState', ({ roomId }) => {
    if (rooms[roomId]) s.emit('gameState', rooms[roomId]);
  });

  s.on('gameAction', ({ roomId, action, data }) => {
    const r = rooms[roomId];
    if (!r || !r.gameStarted || r.winner) return;

    const p = r.players.find(x => x.id === s.id);
    if (!p || p.id !== r.currentTurn) return;

    const o =
      r.players.find(x => x.id === data?.target && x.id !== s.id) ||
      r.players.find(x => x.id !== s.id);

    let done = false;

    if (action === 'lay') {
      const ids = ['مرغ', 'خروس', 'لانه'].map(c => p.hand.indexOf(c));
      if (ids.every(i => i >= 0) && r.eggTokens) {
        ids.sort((a, b) => b - a).forEach(i => p.hand.splice(i, 1));
        p.eggs++;
        r.eggTokens--;
        done = true;
      }
    }

    if (
      action === 'hatch' &&
      p.eggs > 0 &&
      p.hand.filter(x => x === 'مرغ').length >= 2
    ) {
      let n = 0;
      for (let i = 0; i < p.hand.length && n < 2; i++) {
        if (p.hand[i] === 'مرغ') {
          p.hand.splice(i, 1);
          i--;
          n++;
        }
      }
      p.eggs--;
      p.chicks++;
      done = true;
    }

    if (action === 'draw' && r.deck.length) {
      p.hand.push(r.deck.pop());
      done = true;
    }

    if (action === 'discard') {
      const i = p.hand.indexOf(data?.card);
      if (i >= 0) {
        r.discardPile.push(p.hand.splice(i, 1)[0]);
        done = true;
      }
    }

    if (action === 'fox') {
      const i = p.hand.indexOf('روباه');
      if (i >= 0 && o?.eggs > 0) {
        p.hand.splice(i, 1);
        o.eggs--;
        p.eggs++;
        done = true;
      }
    }

    if (action === 'snake') {
      const i = p.hand.indexOf('مار');
      const n = Math.min(2, Math.max(1, Number(data?.count) || 1));
      if (i >= 0 && o?.eggs > 0) {
        p.hand.splice(i, 1);
        const b = Math.min(n, o.eggs);
        o.eggs -= b;
        r.eggTokens += b;
        done = true;
      }
    }

    if (action === 'trap') {
      const i = p.hand.indexOf('تله');
      const c = data?.card;
      const j = o?.hand.indexOf(c);
      if (i >= 0 && j >= 0) {
        p.hand.splice(i, 1);
        o.hand.splice(j, 1);
        done = true;
      }
    }

    if (action === 'endTurn') done = true;
    if (!done) return;

    while (p.hand.length < 4 && r.deck.length) {
      p.hand.push(r.deck.pop());
    }

    finish(r);

    if (!r.winner) {
      const i = r.players.findIndex(x => x.id === r.currentTurn);
      r.currentTurn = r.players[(i + 1) % r.players.length].id;
    }

    io.to(roomId).emit('gameState', r);
  });

  s.on('chatMessage', ({ roomId, message }) => {
    const r = rooms[roomId];
    const p = r?.players.find(x => x.id === s.id);
    if (p) {
      io.to(roomId).emit('chatMessage', {
        sender: p.name,
        message,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  s.on('chatMedia', d => {
    const r = rooms[d.roomId];
    const p = r?.players.find(x => x.id === s.id);
    if (p && (!d.size || d.size <= 5 * 1024 * 1024)) {
      io.to(d.roomId).emit('chatMedia', {
        ...d,
        sender: p.name,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  s.on('rematchRequest', ({ targetId, roomId }) => {
    const a = online.get(s.id);
    const b = online.get(targetId);
    if (b) {
      io.to(targetId).emit('rematchRequest', {
        fromId: s.id,
        fromName: a?.name || 'بازیکن',
        roomId
      });
    }
  });

  s.on('acceptRematch', ({ fromId }) => {
    const a = online.get(fromId);
    const b = online.get(s.id);
    if (a && b) {
      newRoom([
        { id: fromId, name: a.name, accountId: a.accountId, avatar: a.avatar },
        { id: s.id, name: b.name, accountId: b.accountId, avatar: b.avatar }
      ]);
    }
  });

  s.on('rejectRematch', ({ fromId }) =>
    io.to(fromId).emit('rematchRejected', {
      byName: online.get(s.id)?.name || 'حریف'
    })
  );

  s.on('leaveGame', ({ roomId }) => {
    s.leave(roomId || '');
    leaveRoom(s.id);
    const o = online.get(s.id);
    if (o) o.status = 'ready';
    broadcast();
  });

  s.on('webrtc-offer', d => {
    if (d?.to) io.to(d.to).emit('webrtc-offer', { from: s.id, offer: d.offer });
  });

  s.on('webrtc-answer', d => {
    if (d?.to) io.to(d.to).emit('webrtc-answer', { from: s.id, answer: d.answer });
  });

  s.on('webrtc-ice-candidate', d => {
    if (d?.to) io.to(d.to).emit('webrtc-ice-candidate', {
      from: s.id,
      candidate: d.candidate
    });
  });

  s.on('disconnect', () => {
    leaveRoom(s.id);
    online.delete(s.id);
    broadcast();
  });
});

// Express error handler.
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (res.headersSent) return next(err);
  res.status(500).send('خطای داخلی سرور');
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

server.on('error', err => {
  console.error('HTTP server error:', err);
});

server.listen(PORT, HOST, () => {
  console.log(`🐔 سرور مرغ دونی روشن شد`);
  console.log(`🌐 Listening on ${HOST}:${PORT}`);
  console.log(`❤️ Health check: /healthz`);
});
