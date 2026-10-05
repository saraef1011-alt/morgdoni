// Native Node.js game room for Morgdoni.
// No Cloudflare Workers / Durable Objects / WebSocketPair APIs are used here.
class BaseGameRoom {
  constructor(state){this.state=state;this.sessions=new Map();this.ready=this.load()}
  async load(){this.data=await this.state.storage.get('data')||{rooms:{},online:{},accounts:{},pending:{},queue:[]};this.data.rooms??={};this.data.online??={};this.data.accounts??={};this.data.pending??={};this.data.queue??=[];this.data.online={};this.data.pending={};this.data.queue=[];await this.state.storage.put('data',this.data);try{await this.state.storage.setAlarm(Date.now()+15000)}catch{}}
  save(){return this.state.storage.put('data',this.data)}
  send(id,type,data){const ws=this.sessions.get(id);if(ws?.readyState===1)ws.send(JSON.stringify({type,data}))}
  broadcast(type,data){for(const id of this.sessions.keys())this.send(id,type,data)}
  roomBroadcast(r,type,data){if(!r)return;for(const p of r.players||[])this.send(p.id,type,data);for(const id of r.watchers||[])this.send(id,type,data)}
  list(){return Object.values(this.data.online).map(p=>({id:p.id,name:p.name,status:p.status,socketId:p.id,avatar:p.avatar||'🐔'}))}
  updateList(){this.broadcast('playerListUpdate',this.list())}
  account(id,name='بازیکن',avatar='🐔'){return this.data.accounts[id]??(this.data.accounts[id]={accountId:id,username:name,avatar,gamesPlayed:0,wins:0,losses:0,createdAt:Date.now()})}
  player(p){return{id:p.id,name:p.name,accountId:p.accountId||null,avatar:p.avatar||'🐔',hand:[],eggs:0,chicks:0}}
  roomOf(id){for(const [rid,r] of Object.entries(this.data.rooms)){if(r.players?.some(p=>p.id===id))return{roomId:rid,room:r,role:'player'};if(r.watchers?.includes(id))return{roomId:rid,room:r,role:'watcher'}}return null}
  sameRoom(a,b){return Object.values(this.data.rooms).some(r=>r.players?.some(p=>p.id===a)&&r.players?.some(p=>p.id===b))}
  startGame(rid){const r=this.data.rooms[rid];if(!r||r.players.length<2)return false;r.gameStarted=true;r.deck=createDeck();r.discardPile=[];r.eggTokens=18;r.winner=null;r.currentTurn=r.players[0].id;for(const p of r.players){p.hand=[];p.eggs=0;p.chicks=0;for(let i=0;i<4&&r.deck.length;i++)p.hand.push(r.deck.pop());if(this.data.online[p.id])this.data.online[p.id].status='playing'}this.roomBroadcast(r,'gameStarted',{roomId:rid,players:r.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar||'🐔',accountId:p.accountId||null,eggs:p.eggs||0,chicks:p.chicks||0})),state:r});this.roomBroadcast(r,'gameState',r);return true}
  newRoom(a,b,start=true){let rid;do{rid=Math.random().toString(36).slice(2,8).toUpperCase()}while(this.data.rooms[rid]);this.data.rooms[rid]={host:a.id,players:[this.player(a),this.player(b)],watchers:[],gameStarted:false,deck:createDeck(),eggTokens:18,currentTurn:null,winner:null,discardPile:[]};if(start)this.startGame(rid);return rid}
  async finish(r){const w=r.players.find(p=>p.chicks>=3);if(!w||r.winner)return;r.winner=w.id;for(const p of r.players){const a=this.account(p.accountId||p.id,p.name,p.avatar);a.gamesPlayed=(a.gamesPlayed||0)+1;if(p.id===w.id)a.wins=(a.wins||0)+1;else a.losses=(a.losses||0)+1;this.send(p.id,'profileData',{profile:a})}}
  async close(id){
    await this.ready;
    const pending = this.data.pending?.[id] || [];
    for (const req of pending) {
      if (this.data.online?.[req.fromId]) {
        if (this.data.online[req.fromId].status === 'requesting') this.data.online[req.fromId].status = 'ready';
        this.send(req.fromId, 'gameRequestCancelled', { reason: 'طرف مقابل قطع شد' });
      }
    }
    delete this.data.pending[id];
    for (const targetId of Object.keys(this.data.pending || {})) {
      const arr = this.data.pending[targetId] || [];
      const kept = arr.filter(x => x.fromId !== id);
      if (kept.length !== arr.length) {
        this.data.pending[targetId] = kept;
        this.send(targetId, 'gameRequestCancelled', { reason: 'طرف مقابل قطع شد' });
      }
      if (!this.data.pending[targetId]?.length) delete this.data.pending[targetId];
    }
    const cur = this.roomOf(id);
    if (cur) {
      const r = cur.room;
      r.players = (r.players || []).filter(p => p.id !== id);
      r.watchers = (r.watchers || []).filter(x => x !== id);
      if (!r.players.length) {
        delete this.data.rooms[cur.roomId];
      } else {
        if (r.host === id) r.host = r.players[0].id;
        if (r.currentTurn === id) r.currentTurn = r.players[0].id;
        this.roomBroadcast(r, 'roomUpdate', r);
        this.roomBroadcast(r, 'gameState', r);
        this.roomBroadcast(r, 'webrtc-peer-left', { peerId: id });
      }
    }
    delete this.data.online[id];
    this.data.queue = (this.data.queue || []).filter(x => x !== id);
    this.sessions.delete(id);
    this.updateList();
    await this.save();
  }
}


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
      if ((r.players?.length || 0) >= 50) return this.send(id, 'roomError', 'ظرفیت اتاق پر است (حداکثر 50 بازیکن)');
      const p = online[id] || { id, name: String(d.playerName || 'بازیکن').slice(0,20) || 'بازیکن', accountId:id, avatar:'🐔', status:'ready' };
      online[id] ??= p;
      const np = this.player(p); r.players ??= []; r.watchers ??= [];
      if (r.gameStarted) {
        for (let i=0;i<4 && r.deck?.length;i++) np.hand.push(r.deck.pop());
        r.players.push(np); online[id].status='playing';
        this.send(id,'joinExistingGame',{roomId:rid,room:r,mode:'player'});
      } else {
        r.players.push(np); online[id].status='room';
        this.send(id,'roomJoined',{roomId:rid,playerCount:r.players.length,maxPlayers:50});
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
