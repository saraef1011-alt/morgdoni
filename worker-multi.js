import { GameRoom as BaseGameRoom } from './worker.js';

const MAX_PLAYERS = 50;

export class GameRoom extends BaseGameRoom {
  async message(id, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return this.send(id, 'error', 'درخواست نامعتبر است'); }
    const t = m?.type, d = m?.data || {};
    await this.ready;

    if (t === 'singlePlayer') {
      const online = this.data.online;
      const human = online[id] || {
        id,
        name: String(d.playerName || 'بازیکن').trim().slice(0, 20) || 'بازیکن',
        accountId: id,
        avatar: '🐔',
        status: 'ready'
      };
      online[id] = human;
      const botId = 'BOT-' + crypto.randomUUID();
      const bot = {
        id: botId,
        name: 'مرغ‌دونِ هوشمند',
        accountId: botId,
        avatar: '🤖',
        status: 'playing'
      };
      human.status = 'playing';
      const roomId = this.newRoom(human, bot, true);
      this.send(id, 'singlePlayerReady', { roomId, botName: bot.name });
      this.updateList();
      await this.save();
      return;
    }

    if (t === 'chatMessage') {
      const current = this.roomOf(id);
      const room = current?.room;
      const human = room?.players?.find(p => p.id === id);
      if (!room || !human) return;
      const message = String(d.message || '').trim().slice(0, 500);
      if (!message) return;
      const bot = room.players.find(p => String(p.id).startsWith('BOT-'));
      this.send(id, 'chatMessage', {
        sender: human.name,
        message,
        time: new Date().toLocaleTimeString()
      });
      if (bot) {
        const reply = this.botChatReply(message, human.name, room);
        this.send(id, 'chatMessage', {
          sender: bot.name,
          message: reply,
          time: new Date().toLocaleTimeString()
        });
      }
      return;
    }

    if (t === 'chatMessage') {
      const current = this.roomOf(id);
      const room = current?.room;
      const human = room?.players?.find(p => p.id === id);
      if (!room || !human) return;
      const message = String(d.message || '').trim().slice(0, 500);
      if (!message) return;
      const bot = room.players.find(p => String(p.id).startsWith('BOT-'));
      this.send(id, 'chatMessage', {
        sender: human.name,
        message,
        time: new Date().toLocaleTimeString()
      });
      if (bot) {
        const reply = this.botChatReply(message, human.name, room);
        this.send(id, 'chatMessage', {
          sender: bot.name,
          message: reply,
          time: new Date().toLocaleTimeString()
        });
      }
      return;
    }

    if (t === 'gameAction') {
      await super.message(id, raw);
      const current = this.roomOf(id);
      if (current?.room?.gameStarted && !current.room.winner &&
          String(current.room.currentTurn || '').startsWith('BOT-')) {
        await this.botTurn(current.roomId);
      }
      return;
    }

    if (t === 'joinRoom') {
      const rid = String(d.roomId || '').trim().toUpperCase();
      const r = this.data.rooms[rid];
      if (!r) return this.send(id, 'roomError', 'اتاق پیدا نشد');
      const online = this.data.online;
      const existing = this.roomOf(id);
      if (existing) {
        if (existing.roomId === rid) return this.send(id, 'joinExistingGame', { roomId: rid, room: r, mode: existing.role === 'watcher' ? 'watcher' : 'player' });
        return this.send(id, 'roomError', 'ابتدا از اتاق فعلی خارج شوید');
      }
      if ((r.players?.length || 0) >= MAX_PLAYERS) return this.send(id, 'roomError', `ظرفیت اتاق پر است (حداکثر ${MAX_PLAYERS} بازیکن)`);
      const p = online[id] || { id, name: String(d.playerName || 'بازیکن').slice(0,20) || 'بازیکن', accountId:id, avatar:'🐔', status:'ready' };
      online[id] ??= p;
      const np = this.player(p); r.players ??= []; r.watchers ??= [];
      if (r.gameStarted) {
        for (let i=0;i<4 && r.deck?.length;i++) np.hand.push(r.deck.pop());
        r.players.push(np); online[id].status='playing';
        this.send(id,'joinExistingGame',{roomId:rid,room:r,mode:'player'});
      } else {
        r.players.push(np); online[id].status='room';
        this.send(id,'roomJoined',{roomId:rid,playerCount:r.players.length,maxPlayers:MAX_PLAYERS});
      }
      this.roomBroadcast(r,'roomUpdate',r); this.roomBroadcast(r,'gameState',r); this.updateList(); await this.save(); return;
    }

    if (t === 'createRoom') {
      let rid = String(d.roomId || '').trim().toUpperCase();
      if (!rid) rid = Math.random().toString(36).slice(2,8).toUpperCase();
      if (this.data.rooms[rid]) return this.send(id,'roomError','اتاق قبلاً وجود دارد');
      const online=this.data.online;
      const p=online[id]||{id,name:String(d.playerName||'بازیکن').slice(0,20)||'بازیکن',accountId:id,avatar:d.avatar||'🐔',status:'ready'};
      online[id]??=p;
      this.data.rooms[rid]={host:id,players:[this.player(p)],watchers:[],gameStarted:false,deck:createDeck(),eggTokens:18,currentTurn:null,winner:null,discardPile:[]};
      online[id].status='room'; this.send(id,'roomCreated',{roomId:rid}); this.roomBroadcast(this.data.rooms[rid],'roomUpdate',this.data.rooms[rid]); this.updateList(); await this.save(); return;
    }

    if (t === 'requestGame') {
      const me=this.data.online[id], target=this.data.online[d.targetId];
      if (!me || !target) return this.send(id,'gameRequestError','بازیکن مورد نظر یافت نشد');
      if (id===String(d.targetId)) return this.send(id,'gameRequestError','نمی‌توانی به خودت درخواست بدهی');
      this.data.pending[target.id] ??= [];
      this.data.pending[target.id]=this.data.pending[target.id].filter(x=>x.fromId!==id);
      this.data.pending[target.id].push({fromId:id,fromName:me.name,fromAvatar:me.avatar||'🐔',timestamp:Date.now()});
      if(me.status==='ready') me.status='requesting';
      if(target.status==='ready') target.status='requested';
      this.send(target.id,'gameRequest',{fromId:id,fromName:me.name,avatar:me.avatar||'🐔',gameType:'چندنفره'});
      this.send(id,'gameRequestSent',{targetId:target.id,targetName:target.name}); this.updateList(); await this.save(); return;
    }

    return super.message(id, raw);
  }

  botChatReply(message, playerName, room) {
    const text = String(message || '').toLowerCase().replace(/[؟?!.,،]/g, '').trim();
    const human = room.players.find(p => p.name === playerName);
    const bot = room.players.find(p => String(p.id).startsWith('BOT-'));
    const me = bot || {};
    const replies = [
      [/^(سلام|درود|hi|hello|hey)/, ['سلام! 😄 آماده‌ای یه بازی حسابی کنیم؟', 'سلام قهرمان مرغ‌دونی! 🐔', 'درود! امروز شانس با کیه؟']],
      [/(خوبی|چطوری|چه خبر)/, ['من خوبم، ممنون! آماده‌ام برای یه دست هیجان‌انگیز 🤖', 'همه‌چی روبه‌راهه؛ فقط منتظرم حرکت بعدیت رو ببینم!']],
      [/(اسمت|اسم تو|کی هستی)/, ['من مرغ‌دونِ هوشمندم؛ حریف و هم‌صحبتت توی این بازی! 🤖']],
      [/(چند تا جوجه|جوجه|امتیاز|کی جلو)/, [`من ${me.chicks || 0} جوجه دارم و تو ${human?.chicks || 0} تا. هنوز بازی ادامه داره! 🐣`]],
      [/(تخم|تخم گذاشتن)/, ['برای جوجه شدن باید فرصت مناسب رو پیدا کنی. حواست به کارت‌هات باشه! 🥚']],
      [/(روباه|حمله)/, ['حواست به روباه باشه؛ زمان درست استفاده از کارت‌ها خیلی مهمه! 🦊']],
      [/(تقلب|قانون|چطور|چجوری|راهنما)/, ['من طبق کارت‌ها و وضعیت همین دست بازی می‌کنم. کارت‌هات رو بررسی کن و حرکت مناسب رو انتخاب کن.']],
      [/(بردم|برد|باختم|باخت)/, ['هنوز زوده نتیجه بگیریم! تا جوجه سوم، بازی ادامه داره 😎']],
      [/(خداحافظ|فعلا|بای)/, ['فعلاً! هر وقت برگشتی، یه دست دیگه بازی می‌کنیم 👋']],
      [/(مرسی|ممنون|دمت گرم)/, ['خواهش می‌کنم! حالا بریم سراغ بازی 😁']]
    ];
    for (const [pattern, options] of replies) {
      if (pattern.test(text)) return options[Math.floor(Math.random() * options.length)];
    }
    const fallback = [
      'جالبه! بیشتر برام تعریف کن 😄',
      'آها! نظرت درباره حرکت بعدی چیه؟',
      'دارم گوش می‌دم؛ راستی حواست به کارت‌هات باشه 🐔',
      'منم همین‌جام! دوست داری درباره بازی حرف بزنیم یا یه گپ معمولی بزنیم؟',
      'چه جالب! حالا ببینیم توی این دست چه کسی برنده می‌شه 🤖'
    ];
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  async botTurn(roomId) {
    const r = this.data.rooms[roomId];
    if (!r || !r.gameStarted || r.winner) return;
    const bot = r.players.find(p => p.id === r.currentTurn && String(p.id).startsWith('BOT-'));
    const human = r.players.find(p => p.id !== bot?.id);
    if (!bot || !human) return;

    const hand = bot.hand || [];
    const has = card => hand.includes(card);
    let action = 'endTurn', data = null;

    // اولویت: برد فوری، ساخت تخم، سپس حمله‌های قانونی و در پایان تعویض کارت
    if (bot.eggs > 0 && bot.chicks < 3 && hand.filter(x => x === 'مرغ').length >= 2) {
      action = 'hatch';
    } else if (r.eggTokens > 0 && has('مرغ') && has('خروس') && has('لانه')) {
      action = 'lay';
    } else if (human.eggs > 0 && has('روباه')) {
      action = 'fox';
    } else if (human.eggs > 0 && has('مار')) {
      action = 'snake';
      data = { count: Math.min(2, human.eggs) };
    } else if (has('تله') && (human.hand || []).length) {
      const priority = ['مرغ', 'خروس', 'لانه', 'روباه', 'مار', 'تله'];
      const targetCard = priority.find(card => human.hand.includes(card)) || human.hand[0];
      action = 'trap';
      data = { card: targetCard };
    } else if (hand.length < 4 && r.deck?.length) {
      action = 'draw';
    } else {
      const counts = hand.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
      const discard = ['تله', 'مار', 'روباه', 'لانه', 'خروس', 'مرغ']
        .find(card => has(card) && !(card === 'مرغ' && counts['مرغ'] >= 2 && bot.eggs > 0));
      if (discard) {
        action = 'discard';
        data = { card: discard };
      }
    }

    await super.message(bot.id, JSON.stringify({
      type: 'gameAction',
      data: { roomId, action, data }
    }));
  }

  // پاک‌سازی بازیکنان بلافاصله بعد از پایان بازی تا در لابی آنلاین باقی نمانند.
  async finish(r) {
    await super.finish(r);
    const ids = (r?.players || []).map(p => p.id).filter(Boolean);
    for (const id of ids) {
      delete this.data.online[id];
      delete this.data.pending[id];
      this.data.queue = (this.data.queue || []).filter(x => x !== id);
    }
    this.updateList();
    await this.save();
  }
}

const SOCKET_SHIM = `class MorgdoniSocket{constructor(){this.events={};this.id=null;this.queue=[];this._hb=null;this._retry=null;this._closed=false;this.connect()}connect(){if(this._closed)return;const p=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(p+'//'+location.host+'/ws');this.ws.onopen=()=>{if(this._retry){clearTimeout(this._retry);this._retry=null}this.emitLocal('connect');if(this._hb)clearInterval(this._hb);this._hb=setInterval(()=>{if(this.ws&&this.ws.readyState===1)this.ws.send(JSON.stringify({type:'heartbeat'}))},10000);for(const m of this.queue)if(this.ws.readyState===1)this.ws.send(m);this.queue=[]};this.ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m?.type){if(m.type==='hello'&&m.data?.id){this.id=m.data.id;window.myId=m.data.id}this.emitLocal(m.type,m.data)}}catch(x){console.error(x)}};this.ws.onclose=()=>{if(this._hb)clearInterval(this._hb);this._hb=null;this.emitLocal('disconnect');if(!this._closed&&!this._retry)this._retry=setTimeout(()=>{this._retry=null;this.connect()},1500)};this.ws.onerror=e=>this.emitLocal('connect_error',e)}on(e,c){(this.events[e]??=[]).push(c);return this}once(e,c){const f=d=>{this.off(e,f);c(d)};return this.on(e,f)}off(e,c){this.events[e]=(this.events[e]||[]).filter(x=>x!==c);return this}emit(e,d){const m=JSON.stringify({type:e,data:d??null});if(this.ws&&this.ws.readyState===1)this.ws.send(m);else this.queue.push(m);return this}emitLocal(e,d){for(const c of this.events[e]||[])try{c(d)}catch(x){console.error(x)}}disconnect(){this._closed=true;if(this._retry)clearTimeout(this._retry);if(this._hb)clearInterval(this._hb);this._retry=this._hb=null;this.ws?.close()}}window.io=window.io||function(){const s=new MorgdoniSocket();window.__MORG_SOCKET__=s;return s};`;

function createDeck(){const a=[];for(const [t,n] of [['مرغ',21],['خروس',21],['لانه',12],['روباه',7],['تله',3],['مار',2]])for(let i=0;i<n;i++)a.push(t);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

const FORCE_REQUEST = `<script>(function(){'use strict';function go(){const s=window.__MORG_SOCKET__||window.socket;if(!s)return;const me=String(s.id||window.myId||'');document.querySelectorAll('.mlg-player').forEach((row,i)=>{let b=row.querySelector('[data-force-request]');if(b)return;const list=window.__MORG_LAST_PLAYERS__||[];const others=list.filter(p=>p&&p.id&&String(p.id)!==me);const p=others[i];if(!p)return; b=document.createElement('button');b.type='button';b.setAttribute('data-force-request','1');b.textContent='🎮 درخواست بازی';b.style.cssText='display:block!important;width:100%;margin-top:8px;padding:10px;border:0;border-radius:10px;background:#16a34a;color:white;font-weight:800;font-size:14px;cursor:pointer;position:relative;z-index:99999';b.onclick=function(e){e.preventDefault();e.stopPropagation();s.emit('requestGame',{targetId:String(p.id)});b.textContent='📨 ارسال شد';b.disabled=true;setTimeout(function(){if(b.isConnected){b.disabled=false;b.textContent='🎮 درخواست بازی'}},1800)};(row.querySelector('.mlg-actions')||row).appendChild(b)});document.querySelectorAll('#lobbyPlayersArea .player').forEach(row=>{if(row.querySelector('[data-force-request]'))return;const id=row.dataset.id||row.getAttribute('data-player-id');if(!id||id===me)return;const b=document.createElement('button');b.type='button';b.setAttribute('data-force-request','1');b.textContent='🎮 درخواست بازی';b.style.cssText='display:block!important;margin-top:6px;background:#16a34a;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-weight:800';b.onclick=function(e){e.preventDefault();e.stopPropagation();s.emit('requestGame',{targetId:String(id)});b.textContent='📨 ارسال شد'};row.appendChild(b)})}function hook(){const s=window.__MORG_SOCKET__||window.socket;if(s&&!s.__forceReq){s.__forceReq=1;s.on('playerListUpdate',function(l){window.__MORG_LAST_PLAYERS__=Array.isArray(l)?l:[];setTimeout(go,0);setTimeout(go,200)});s.on('connect',go)}go()}setInterval(hook,500);new MutationObserver(go).observe(document.documentElement,{childList:true,subtree:true});hook()})();</script>`;

export default {async fetch(request,env){const u=new URL(request.url);if(u.pathname==='/healthz')return new Response('ok');if(u.pathname==='/socket.io/socket.io.js')return new Response(SOCKET_SHIM,{headers:{'content-type':'application/javascript;charset=utf-8','cache-control':'no-store'}});if(u.pathname==='/ws')return env.GAME_ROOM.get(env.GAME_ROOM.idFromName('morgdoni-lobby')).fetch(request);const response=await env.ASSETS.fetch(request);if(response.status===404)return new Response('Not Found',{status:404});const type=response.headers.get('content-type')||'';if(u.pathname==='/'||u.pathname==='/index.html'||type.includes('text/html')){let html=await response.text();html=html.replace(/<script[^>]+(?:request-ui|lobby-fix|morgdoni-card-fix|online-panel)[^>]*><\/script>/gi,'');if(!/socket\.io\/socket\.io\.js/i.test(html))html=html.replace(/<\/head>/i,'<script src="/socket.io/socket.io.js?v=force3"></script></head>');html=html.replace(/<\/body>/i,'<script src="/morgdoni-card-fix.js?v=force3"></script><script src="/request-ui.js?v=force3"></script><script src="/lobby-fix.js?v=worker1"></script><script src="/morgdoni-features.js?v=1"></script>'+FORCE_REQUEST+'</body>');return new Response(html,{status:response.status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})}return response}};
