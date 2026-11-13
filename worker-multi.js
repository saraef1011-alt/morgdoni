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

    if (t === 'chatMessage') {
      const current = this.roomOf(id);
      const room = current?.room;
      const human = room?.players?.find(p => p.id === id);
      if (!room || !human) return;
      const message = String(d.message || '').trim().slice(0, 500);
      if (!message) return;
      const bot = room.players.find(p => p.isBot);
      this.send(id, 'chatMessage', {
        sender: human.name,
        message,
        time: new Date().toLocaleTimeString()
      });
      if (bot) {
        const reply = await this.botChatReply(message, human.name, room);
        this.send(id, 'chatMessage', {
          sender: bot.name,
          message: reply,
          time: new Date().toLocaleTimeString()
        });
      }
      return;
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

  async botChatReply(message, playerName, room) {
    const human = room.players.find(p => p.name === playerName) || {};
    const bot = room.players.find(p => p.isBot) || {};
    const raw = String(message || '').trim().slice(0, 500);
    const text = raw.toLowerCase().replace(/[؟?!.,،؛:]/g, ' ').replace(/\s+/g, ' ').trim();
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const bank = [
      [/^(سلام|درود|hi|hello|hey|صبح بخیر|عصر بخیر|شب بخیر)/, ['سلام! بالاخره اومدی؛ آماده‌ای رقابت کنیم؟ 🐔','درود رفیق بازی! امروز قراره حسابی بجنگیم 😄','سلام! امیدوارم دستت پر از کارت‌های خوب باشه.','سلام! من آماده‌ام؛ تو چطوری؟']],
      [/(خوبی|چطوری|چه خبر|حالت چطوره)/, ['من عالی‌ام و برای بردن آماده‌ام! تو چطوری؟','همه‌چی روبه‌راهه؛ فقط منتظرم ببینم چه نقشه‌ای داری!','خوبم، ممنون که پرسیدی. اوضاع بازی چطوره؟']],
      [/(اسمت|اسم تو|کی هستی|تو چی هستی)/, ['من مرغ‌دونی هوشمندم؛ حریف دیجیتالی تو! 🤖','اسمم مرغ‌دونی هوشمنده؛ هم بازی می‌کنم، هم گپ می‌زنم!']],
      [/(چند تا جوجه|جوجه|امتیاز|کی جلو|وضعیت بازی|چند چند)/, [`الان من ${bot.chicks || 0} جوجه و تو ${human.chicks || 0} جوجه داری. هنوز چیزی معلوم نیست!`, `امتیاز من ${bot.chicks || 0} و امتیاز تو ${human.chicks || 0} جوجه است. بازی ادامه داره!`]],
      [/(تخم|تخم مرغ|لانه|تخم گذاشتن)/, ['برای تخم گذاشتن باید مرغ، خروس و لانه رو کنار هم داشته باشی. حواست به کارت‌هات باشه!','تخم‌ها خیلی مهمن؛ ولی مراقب روباه و مار هم باش! 🥚']],
      [/(جوجه کردن|جوجه کنم|هچ|درآوردن جوجه)/, ['وقتی تخم داری و دو کارت مرغ دستته، می‌تونی جوجه بگیری. 🐣','هدف اصلی رسیدن به سه جوجه است؛ فرصت مناسب رو از دست نده!']],
      [/(روباه|حمله|دزدیدن|دزدید)/, ['روباه می‌تونه اوضاع رو عوض کنه؛ مخصوصاً وقتی حریف تخم داشته باشه! 🦊','مواظب روباه باش؛ من هم همیشه چشمم به تخم‌هات هست!']],
      [/(مار|شکستن تخم)/, ['مار برای خراب کردن تخم‌های حریف خطرناکه؛ مراقبش باش! 🐍','اگه تخم داری، حواست به مار باشه.']],
      [/(تله|دام)/, ['تله می‌تونه یکی از کارت‌های حریف رو از بین ببره. زمان استفاده‌اش مهمه!','تله رو دست‌کم نگیر؛ گاهی یه کارت می‌تونه کل نقشه رو عوض کنه.']],
      [/(کارت|دستت|دستم|چی داری|چه کارت)/, ['کارت‌های دستم محرمانه‌ان! 😄 باید از روی حرکت‌هام حدس بزنی.','راز کارت‌هام رو که نمی‌گم! این خودش بخشی از هیجان بازیه.']],
      [/(قانون|چطور|چجوری|راهنما|یاد بده|یادگیری)/, ['ترکیب مرغ، خروس و لانه برای گرفتن تخم مهمه؛ با دو مرغ و یک تخم هم جوجه می‌گیری.','کارت‌ها رو هوشمندانه نگه دار؛ برای سه جوجه باید برنامه‌ریزی کنی.']],
      [/(تقلب|کلک)/, ['نه نه! اینجا فقط فکر و برنامه‌ریزی جواب می‌ده! 😎','من طبق قوانین بازی می‌کنم؛ برد واقعی باهوشانه‌ست!']],
      [/(بردم|برنده|می برم|میبرم)/, ['هنوز جشن نگیر! تا رسیدن به سه جوجه بازی ادامه داره!','اعتمادبه‌نفس خوبه، ولی منم هنوز توی رقابتم! 😁']],
      [/(باختم|باختی|باخت)/, ['هنوز فرصت جبران هست؛ یه حرکت خوب می‌تونه بازی رو برگردونه.','بازی همینه؛ از هر دست می‌شه یه چیز تازه یاد گرفت!']],
      [/(مرسی|ممنون|متشکر|دمت گرم)/, ['خواهش می‌کنم! حالا بریم سراغ رقابت!','قابلی نداشت؛ ولی حواست به حرکت بعدی من باشه!']],
      [/(ببخش|معذرت|شرمنده)/, ['اشکالی نداره! بازی باید خوش بگذره.','مهم اینه که با حال خوب بازی کنیم!']],
      [/(خداحافظ|فعلا|فعلاً|بای|شب بخیر)/, ['فعلاً! امیدوارم دفعه بعد هم بازی کنیم. 👋','خداحافظ! مراقب مرغ و تخم‌هات باش! 🐔']],
      [/(دوست داری|دوست من|رفیق)/, ['من رفیق رقابتی توام؛ البته توی بازی کوتاه نمیام! 😄','گپ زدن خوبه، ولی رقابت با تو جذاب‌تره!']],
      [/(خسته|حوصله|کسل)/, ['پس یه حرکت هیجان‌انگیز بزن تا بازی جون بگیره!','بیا بازی رو جذاب کنیم؛ هنوز کلی اتفاق ممکنه بیفته!']],
      [/(چرا|چیکار|چه کار)/, ['دارم بهترین فرصت رو بررسی می‌کنم؛ عجله همیشه خوب نیست!','یه کم صبر کن؛ شاید حرکت بعدی غافلگیرت کنه.']],
      [/(هوش مصنوعی|ربات|باهوش|هوشمند)/, ['من دارم تلاش می‌کنم هر دست بهتر بازی کنم و بهتر جواب بدم! 🤖','هوشمند بودن یعنی فقط کارت نکشیم؛ باید موقعیت رو هم بسنجیم!']],
      [/(خنده|جوک|شوخی)/, ['چرا مرغ از خیابون رد شد؟ چون می‌خواست بره توی دست برنده‌ها! 😂','یه روز روباه به مرغ گفت: نترس، فقط اومدم تخم‌مرغاتو ببینم! 🦊']],
      [/(آفرین|عالی|خوبه|خوب بود)/, ['ممنون! ولی هنوز بازی تموم نشده؛ آماده حرکت بعدی باش!','تو هم بد بازی نمی‌کنی؛ رقابت جذاب شده!']],
      [/(نه|نخیر|اشتباه)/, ['ممکنه حق با تو باشه؛ دقیق‌تر بگو منظورت چیه؟','باشه، توضیح بده تا بهتر متوجه بشم.']]
    ];
    for (const [pattern, replies] of bank) if (pattern.test(text)) return pick(replies);

    const generic = [
      'جالبه! بیشتر برام تعریف کن.',
      'آها، دارم گوش می‌دم. راستی نقشه‌ات برای برد چیه؟',
      'نظرت درباره حرکت بعدی چیه؟ من که یه نقشه‌هایی دارم! 😄',
      'این حرفت جالب بود؛ حالا ببینیم توی بازی چه اتفاقی می‌افته.',
      'من حواسم به بازی هست، ولی گپ زدن هم بد نیست!',
      'یه کم بیشتر توضیح بده تا بهتر جواب بدم.',
      'ممکنه! باید ببینیم کارت‌ها چه فرصتی بهمون می‌دن.',
      'تو اول حرکتت رو بزن، بعد می‌فهمیم کدوم‌مون زرنگ‌تریم! 🐔'
    ];
    const localReply = () => {
      for (const [pattern, replies] of bank) if (pattern.test(text)) return pick(replies);
      return pick(generic);
    };

    try {
      if (!this.env?.AI?.run) return localReply();
      const history = Array.isArray(room.botChatHistory) ? room.botChatHistory.slice(-8) : [];
      const gameState = {
        players: (room.players || []).map(p => ({name:p.name,isBot:!!p.isBot,eggs:p.eggs||0,chicks:p.chicks||0,handCount:(p.hand||[]).length})),
        eggTokens: room.eggTokens,
        currentTurn: room.players?.find(p => p.id === room.currentTurn)?.name || null
      };
      const system = 'تو مرغ‌دونی هوشمند هستی؛ حریف بازی و هم‌صحبت فارسی‌زبان. به هر موضوعی که بازیکن مطرح می‌کند طبیعی، دوستانه و مرتبط جواب بده؛ فقط درباره بازی حرف نزن. جواب‌ها کوتاه و متنوع باشند. وضعیت بازی را از داده‌های داده‌شده بخوان و جعل نکن. کارت‌های مخفی را فاش نکن. برای سلام، احوال‌پرسی، شوخی، تشکر، خداحافظی، پرسش درباره بازی و گفت‌وگوی روزمره پاسخ مناسب بده. حداکثر دو جمله. وضعیت: '+JSON.stringify(gameState);
      const result = await this.env.AI.run('@cf/openai/gpt-oss-20b', {
        messages:[{role:'system',content:system},...history,{role:'user',content:playerName+' می‌گوید: '+raw}],
        max_tokens:180,
        temperature:0.85
      });
      let reply = result?.response || result?.output_text || result?.result?.response || '';
      if (!reply && Array.isArray(result?.output)) reply=result.output.flatMap(x=>x.content||[]).map(x=>x.text||'').join(' ');
      reply=String(reply||'').trim().slice(0,700);
      if (!reply) return localReply();
      room.botChatHistory=[...history,{role:'user',content:raw},{role:'assistant',content:reply}].slice(-10);
      this.save().catch(()=>{});
      return reply;
    } catch (error) {
      console.error('Morgdoni AI chat error:',error);
      return localReply();
    }
  }

  // نوبت‌گیری هوشمند: اول حرکت‌های امتیازساز، بعد حمله و در نهایت کشیدن کارت.
  async runBotTurns(r) {
    let safety = 0;
    while (r && !r.winner && safety++ < 3) {
      const bot = r.players.find(p => p.id === r.currentTurn && p.isBot);
      if (!bot) break;
      const target = r.players.find(p => p.id !== bot.id);
      const hand = bot.hand || [];
      const take = card => { const i=hand.indexOf(card); if(i<0)return false; hand.splice(i,1); return true; };
      let acted = false;

      // بردن بازی همیشه مهم‌ترین اولویت است.
      if (bot.eggs > 0 && hand.filter(x=>x==='مرغ').length >= 2) {
        for(let n=0;n<2;n++) take('مرغ');
        bot.eggs--; bot.chicks++; acted=true;
      } else if (r.eggTokens > 0 && ['مرغ','خروس','لانه'].every(x=>hand.includes(x))) {
        take('مرغ'); take('خروس'); take('لانه'); bot.eggs++; r.eggTokens--; acted=true;
      } else if (target?.eggs > 0 && hand.includes('روباه')) {
        take('روباه');
        const roosters=target.hand?.filter(x=>x==='خروس').length||0;
        if(roosters>=2){let n=0;for(let i=0;i<target.hand.length&&n<2;i++)if(target.hand[i]==='خروس'){target.hand.splice(i,1);i--;n++;}}
        else {target.eggs--;bot.eggs++;}
        acted=true;
      } else if (target?.eggs > 0 && hand.includes('مار')) {
        take('مار');
        const broken=Math.min(2,target.eggs);
        target.eggs-=broken; r.eggTokens=(r.eggTokens||0)+broken; acted=true;
      } else if (target?.hand?.length && hand.includes('تله')) {
        take('تله');
        // کارت باارزش‌تر حریف را هدف می‌گیرد، بدون نمایش آن به بازیکن.
        const value={ 'مرغ':5,'خروس':5,'لانه':5,'روباه':4,'مار':3,'تله':2 };
        let ix=0;
        for(let i=1;i<target.hand.length;i++) if((value[target.hand[i]]||1)>(value[target.hand[ix]]||1)) ix=i;
        target.hand.splice(ix,1); acted=true;
      }

      // اگر حرکت ویژه‌ای ممکن نبود، کارت تازه می‌کشد؛ دست ربات بی‌دلیل خالی نمی‌شود.
      if (!acted) {
        if (r.deck?.length) { hand.push(r.deck.pop()); acted=true; }
        else if (r.discardPile?.length) { r.deck=shuffle([...r.discardPile]);r.discardPile=[];hand.push(r.deck.pop());acted=true; }
      }
      if (!acted) break;
      while(hand.length<4 && r.deck?.length) hand.push(r.deck.pop());
      await this.finish(r);
      if(r.winner) break;
      const turnIndex=r.players.findIndex(x=>x.id===r.currentTurn);
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
