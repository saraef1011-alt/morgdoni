import { GameRoom as BaseGameRoom } from './worker.js';

const MAX_PLAYERS = 50;

export class GameRoom extends BaseGameRoom {
  async message(id, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return this.send(id, 'error', 'درخواست نامعتبر است'); }
    const t = m?.type, d = m?.data || {};
    await this.ready;

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
}

const SOCKET_SHIM = `class MorgdoniSocket{constructor(){this.events={};this.id=null;this.queue=[];const p=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(p+'//'+location.host+'/ws');this.ws.onopen=()=>{this.emitLocal('connect');for(const m of this.queue)this.ws.send(m);this.queue=[]};this.ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m?.type){if(m.type==='hello'&&m.data?.id)this.id=m.data.id;this.emitLocal(m.type,m.data)}}catch(x){console.error(x)}};this.ws.onclose=()=>this.emitLocal('disconnect');this.ws.onerror=e=>this.emitLocal('connect_error',e)}on(e,c){(this.events[e]??=[]).push(c);return this}once(e,c){const f=d=>{this.off(e,f);c(d)};return this.on(e,f)}off(e,c){this.events[e]=(this.events[e]||[]).filter(x=>x!==c);return this}emit(e,d){const m=JSON.stringify({type:e,data:d??null});if(this.ws.readyState===1)this.ws.send(m);else this.queue.push(m);return this}emitLocal(e,d){for(const c of this.events[e]||[])try{c(d)}catch(x){console.error(x)}}disconnect(){this.ws?.close()}}window.io=window.io||function(){const s=new MorgdoniSocket();window.__MORG_SOCKET__=s;return s};`;
function createDeck(){const a=[];for(const [t,n] of [['مرغ',21],['خروس',21],['لانه',12],['روباه',7],['تله',3],['مار',2]])for(let i=0;i<n;i++)a.push(t);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

const FORCE_REQUEST = `<script>(function(){'use strict';function go(){const s=window.__MORG_SOCKET__||window.socket;if(!s)return;const me=String(s.id||window.myId||'');document.querySelectorAll('.mlg-player').forEach((row,i)=>{let b=row.querySelector('[data-force-request]');if(b)return;const list=window.__MORG_LAST_PLAYERS__||[];const others=list.filter(p=>p&&p.id&&String(p.id)!==me);const p=others[i];if(!p)return; b=document.createElement('button');b.type='button';b.setAttribute('data-force-request','1');b.textContent='🎮 درخواست بازی';b.style.cssText='display:block!important;width:100%;margin-top:8px;padding:10px;border:0;border-radius:10px;background:#16a34a;color:white;font-weight:800;font-size:14px;cursor:pointer;position:relative;z-index:99999';b.onclick=function(e){e.preventDefault();e.stopPropagation();s.emit('requestGame',{targetId:String(p.id)});b.textContent='📨 ارسال شد';b.disabled=true;setTimeout(function(){if(b.isConnected){b.disabled=false;b.textContent='🎮 درخواست بازی'}},1800)};(row.querySelector('.mlg-actions')||row).appendChild(b)});document.querySelectorAll('#lobbyPlayersArea .player').forEach(row=>{if(row.querySelector('[data-force-request]'))return;const id=row.dataset.id||row.getAttribute('data-player-id');if(!id||id===me)return;const b=document.createElement('button');b.type='button';b.setAttribute('data-force-request','1');b.textContent='🎮 درخواست بازی';b.style.cssText='display:block!important;margin-top:6px;background:#16a34a;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-weight:800';b.onclick=function(e){e.preventDefault();e.stopPropagation();s.emit('requestGame',{targetId:String(id)});b.textContent='📨 ارسال شد'};row.appendChild(b)})}function hook(){const s=window.__MORG_SOCKET__||window.socket;if(s&&!s.__forceReq){s.__forceReq=1;s.on('playerListUpdate',function(l){window.__MORG_LAST_PLAYERS__=Array.isArray(l)?l:[];setTimeout(go,0);setTimeout(go,200)});s.on('connect',go)}go()}setInterval(hook,500);new MutationObserver(go).observe(document.documentElement,{childList:true,subtree:true});hook()})();</script>`;

export default {async fetch(request,env){const u=new URL(request.url);if(u.pathname==='/healthz')return new Response('ok');if(u.pathname==='/socket.io/socket.io.js')return new Response(SOCKET_SHIM,{headers:{'content-type':'application/javascript;charset=utf-8','cache-control':'no-store'}});if(u.pathname==='/ws')return env.GAME_ROOM.get(env.GAME_ROOM.idFromName('morgdoni-lobby')).fetch(request);const response=await env.ASSETS.fetch(request);if(response.status===404)return new Response('Not Found',{status:404});const type=response.headers.get('content-type')||'';if(u.pathname==='/'||u.pathname==='/index.html'||type.includes('text/html')){let html=await response.text();html=html.replace(/<script[^>]+(?:request-ui|lobby-fix|morgdoni-card-fix|online-panel)[^>]*><\/script>/gi,'');if(!/socket\.io\/socket\.io\.js/i.test(html))html=html.replace(/<\/head>/i,'<script src="/socket.io/socket.io.js?v=force3"></script></head>');html=html.replace(/<\/body>/i,'<script src="/morgdoni-card-fix.js?v=force3"></script><script src="/request-ui.js?v=force3"></script><script src="/lobby-fix.js?v=force3"></script><script src="/online-panel.js?v=force3"></script>'+FORCE_REQUEST+'</body>');return new Response(html,{status:response.status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})}return response}};
