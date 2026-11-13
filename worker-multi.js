import { GameRoom as BaseGameRoom } from './worker.js';

const MAX_PLAYERS = 50;

export class GameRoom extends BaseGameRoom {
  constructor(state, env) { super(state); this.env = env; }

  async message(id, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return this.send(id, 'error', 'درخواست نامعتبر است'); }
    const t = m?.type, d = m?.data || {};
    await this.ready;

    if (t === 'singlePlayer') {
      // Use the exact same bot setup and turn engine as the base worker.
      const player = this.data.online[id] || {
        id,
        name: String(d.playerName || 'بازیکن').trim().slice(0, 20) || 'بازیکن',
        accountId: id,
        avatar: '🐔',
        status: 'ready'
      };
      this.data.online[id] = player;
      player.status = 'ready';
      return super.message(id, JSON.stringify({
        type: 'playWithAI',
        data: {}
      }));
    }

    if (t === 'gameAction') {
      // منطق نوبت‌دهی و اجرای نوبت ربات در GameRoom پایه انجام می‌شود.
      return super.message(id, raw);
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

  // تصمیم‌گیری ربات: اول برد خودش، بعد جلوگیری از برد حریف، بعد حمله و در آخر تعویض کارت ضعیف.
  async runBotTurns(r) {
    let safety = 0;
    while (r && !r.winner && safety++ < 10) {
      const bot = r.players.find(p => p.id === r.currentTurn && p.isBot);
      if (!bot) break;

      bot.hand ||= [];
      while (bot.hand.length > 4) r.discardPile.push(bot.hand.pop());

      const enemies = r.players.filter(p => p.id !== bot.id);
      const target = enemies.sort((a,b) =>
        ((b.chicks||0)*100 + (b.eggs||0)*12 - (b.hand?.filter(c=>c==='خروس').length>=2?8:0)) -
        ((a.chicks||0)*100 + (a.eggs||0)*12 - (a.hand?.filter(c=>c==='خروس').length>=2?8:0))
      )[0];
      const take = card => {
        const i = bot.hand.indexOf(card);
        if (i < 0) return false;
        bot.hand.splice(i, 1);
        return true;
      };
      const reshuffle = () => {
        if (r.deck?.length || !r.discardPile?.length) return;
        r.deck = [...r.discardPile];
        r.discardPile = [];
        for (let i=r.deck.length-1;i>0;i--) {
          const j=Math.floor(Math.random()*(i+1));
          [r.deck[i],r.deck[j]]=[r.deck[j],r.deck[i]];
        }
      };
      const drawToFour = () => {
        reshuffle();
        while (bot.hand.length < 4 && r.deck?.length) bot.hand.push(r.deck.pop());
      };

      let acted = false;

      // اگر با دو مرغ بتواند جوجه بسازد، همیشه این حرکت را انجام می‌دهد.
      if (bot.eggs > 0 && bot.hand.filter(c=>c==='مرغ').length >= 2) {
        let removed=0;
        for(let i=0;i<bot.hand.length && removed<2;i++) {
          if(bot.hand[i]==='مرغ'){bot.hand.splice(i,1);i--;removed++;}
        }
        bot.eggs--; bot.chicks++; acted=true;
      }
      // ساخت تخم جدید، وقتی ترکیب کامل را دارد.
      else if (r.eggTokens > 0 && ['مرغ','خروس','لانه'].every(c=>bot.hand.includes(c))) {
        take('مرغ'); take('خروس'); take('لانه');
        bot.eggs++; r.eggTokens--; acted=true;
      }
      // روباه را علیه حریفی به کار می‌برد که تخم دارد و دفاعش ضعیف‌تر است.
      else if (target?.eggs > 0 && bot.hand.includes('روباه')) {
        take('روباه');
        const roosters=target.hand?.filter(c=>c==='خروس').length||0;
        if(roosters>=2) {
          let removed=0;
          for(let i=0;i<target.hand.length && removed<2;i++) {
            if(target.hand[i]==='خروس'){target.hand.splice(i,1);i--;removed++;}
          }
        } else { target.eggs--; bot.eggs++; }
        acted=true;
      }
      // مار تا دو تخم حریف را از بین می‌برد.
      else if (target?.eggs > 0 && bot.hand.includes('مار')) {
        take('مار');
        const broken=Math.min(2,target.eggs);
        target.eggs-=broken;
        r.eggTokens=(r.eggTokens||0)+broken;
        acted=true;
      }
      // تله مهم‌ترین کارت حریف را هدف می‌گیرد.
      else if (target?.hand?.length && bot.hand.includes('تله')) {
        take('تله');
        const value={'مرغ':6,'خروس':6,'لانه':6,'روباه':5,'مار':4,'تله':3};
        let ix=0;
        for(let i=1;i<target.hand.length;i++) {
          if((value[target.hand[i]]||1)>(value[target.hand[ix]]||1)) ix=i;
        }
        target.hand.splice(ix,1);
        acted=true;
      }

      if (acted) {
        drawToFour();
      } else {
        // اگر دستش پر است، کم‌ارزش‌ترین کارت را دور می‌اندازد و جایگزین می‌کشد؛ هرگز کارت پنجم نمی‌گیرد.
        if (bot.hand.length >= 4) {
          const score = card => {
            let n=({ 'مرغ':4,'خروس':4,'لانه':4,'روباه':1,'مار':1,'تله':1 }[card]||0);
            if (bot.eggs>0 && card==='مرغ') n+=7;
            if (r.eggTokens>0 && ['مرغ','خروس','لانه'].includes(card)) {
              const missing=['مرغ','خروس','لانه'].filter(c=>!bot.hand.includes(c)).length;
              if(missing<=1) n+=5;
              else n+=1;
            }
            if (target?.eggs>0 && card==='روباه') n+=8;
            if (target?.eggs>0 && card==='مار') n+=6;
            if (target?.hand?.length && card==='تله') n+=3;
            return n;
          };
          let weakest=0;
          for(let i=1;i<bot.hand.length;i++) if(score(bot.hand[i])<score(bot.hand[weakest])) weakest=i;
          r.discardPile.push(bot.hand.splice(weakest,1)[0]);
        }
        drawToFour();
      }

      await this.finish(r);
      if (r.winner) break;
      const turnIndex=r.players.findIndex(p=>p.id===r.currentTurn);
      r.currentTurn=r.players[(turnIndex+1)%r.players.length].id;
    }
  }


  // پاک‌سازی بازیکنان بلافاصله بعد از پایان بازی تا در لابی آنلاین باقی نمانند.
  async finish(r) {
    await super.finish(r);
    // Base finish() returns without a winner after ordinary turns.
    // Do not remove players from the online list until the match is truly over.
    if (!r?.winner) return;
    const ids = (r.players || []).map(p => p.id).filter(Boolean);
    for (const id of ids) {
      if (String(id).startsWith('bot-')) continue;
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
