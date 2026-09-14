(()=>{
'use strict';
let socket=null, online=[], incoming=[], lobbyOpen=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const style=document.createElement('style');
style.textContent=`
#morgLobbyScreen{position:fixed;inset:0;z-index:50000;background:linear-gradient(145deg,#2b1d17,#5b341f);padding:22px;overflow:auto;direction:rtl}
#morgLobbyScreen *{box-sizing:border-box;font-family:'Segoe UI',Tahoma,sans-serif}
.mlg-wrap{max-width:1250px;margin:auto;background:#fff8ec;border:3px solid #ead2ad;border-radius:34px;min-height:calc(100vh - 44px);box-shadow:0 18px 70px #0008;overflow:hidden}
.mlg-head{padding:20px 24px;background:linear-gradient(145deg,#fffaf1,#f6e5cc);border-bottom:2px solid #e2c49b;display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}
.mlg-title{font-size:1.8rem;font-weight:900;color:#9a4d16}.mlg-sub{color:#80644b;margin-top:5px}.mlg-close{border:0;border-radius:18px;padding:11px 18px;background:#7f8c8d;color:#fff;font-weight:800;cursor:pointer}
.mlg-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:14px;background:#f8ead7}.mlg-tab{border:2px solid #e1c39d;background:#fffaf1;padding:13px;border-radius:17px;font-weight:900;color:#57341f;cursor:pointer}.mlg-tab.active{background:#3a271e;color:#fff;border-color:#3a271e}
.mlg-body{padding:20px}.mlg-section{background:#fffdf8;border:2px solid #ead8bd;border-radius:24px;padding:18px;margin-bottom:16px}.mlg-section h2{margin:0 0 14px;color:#8e4615;font-size:1.25rem}.mlg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
.mlg-player,.mlg-request,.mlg-room{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid #ead8bd;border-radius:18px;background:#fffaf2}.mlg-info{display:flex;align-items:center;gap:10px;min-width:0}.mlg-avatar{width:45px;height:45px;border-radius:50%;display:grid;place-items:center;background:#f4e2c5;font-size:1.6rem;flex:none}.mlg-name{font-weight:900;color:#42291b}.mlg-meta{font-size:.78rem;color:#8b7b6e;margin-top:3px}.mlg-online{color:#21a657;font-weight:800}.mlg-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.mlg-btn{border:0;border-radius:14px;padding:9px 12px;font-weight:900;cursor:pointer}.mlg-play{background:#64ad50;color:#fff}.mlg-accept{background:#27ae60;color:#fff}.mlg-reject{background:#d94b42;color:#fff}.mlg-watch{background:#4c91c7;color:#fff}.mlg-refresh{background:#ead7bd;color:#55331f;width:100%;margin-top:12px}.mlg-empty{text-align:center;padding:22px;color:#927b66}.mlg-badge{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:12px;background:#e53935;color:#fff;font-size:.75rem;margin-right:5px}
#morgBusyGameChoice{position:fixed;inset:0;z-index:100000;background:#0009;display:grid;place-items:center;padding:18px;direction:rtl}.mgb-box{width:min(520px,94vw);background:#fff8ec;border:3px solid #e5bd7c;border-radius:28px;padding:24px;box-shadow:0 20px 70px #000b;text-align:center}.mgb-box h2{margin:0 0 10px;color:#8e4615;font-size:1.45rem}.mgb-box p{color:#5d4939;margin:8px 0 20px}.mgb-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mgb-btn{border:0;border-radius:17px;padding:15px 10px;font-size:1rem;font-weight:900;cursor:pointer}.mgb-join{background:#27ae60;color:#fff}.mgb-watch{background:#4c91c7;color:#fff}.mgb-cancel{margin-top:10px;width:100%;background:#7f8c8d;color:#fff}.mgb-note{font-size:.82rem;color:#8b7b6e;margin-top:12px}
@media(max-width:650px){#morgLobbyScreen{padding:8px}.mlg-wrap{min-height:calc(100vh - 16px);border-radius:22px}.mlg-tabs{grid-template-columns:1fr}.mlg-grid{grid-template-columns:1fr}.mlg-head{padding:15px}.mlg-body{padding:12px}.mlg-player,.mlg-request,.mlg-room{align-items:flex-start;flex-direction:column}.mlg-actions{width:100%}.mlg-btn{flex:1}.mgb-actions{grid-template-columns:1fr}}
`;
document.head.appendChild(style);

function getSocket(){return window.__MORG_SOCKET__||null}
function install(s){if(!s||socket===s)return;socket=s;
 s.on('playerListUpdate',l=>{online=Array.isArray(l)?l:[];render()});
 s.on('registrationSuccess',()=>setTimeout(()=>s.emit('getPlayerList'),100));
 s.on('gameRequest',d=>{if(d){incoming.push({...d,_key:String(d.fromId||d.fromName||Date.now())});render();setLobbyBadge()}});
 s.on('busyGameChoice',d=>showBusyChoice(d));
 s.on('gameRejected',()=>render());
 s.on('gameRequestSent',d=>{if(d)console.log('درخواست بازی ارسال شد به',d.targetName||d.targetId);render()});
 s.on('gameRequestError',d=>{console.warn(d);alert(d||'ارسال درخواست بازی ناموفق بود');render()});
 s.on('gameError',d=>{console.warn(d);alert(d||'خطای بازی')});
 s.emit('getPlayerList');
}
function showBusyChoice(d){
 document.getElementById('morgBusyGameChoice')?.remove();
 const root=document.createElement('div');root.id='morgBusyGameChoice';
 root.innerHTML=`<div class="mgb-box"><h2>🎮 درخواست ورود به بازی</h2><p><b>${esc(d?.fromName||'یک بازیکن')}</b> می‌خواهد وارد بازی شما شود.</p><div class="mgb-actions"><button class="mgb-btn mgb-join" id="mgbJoin">👥 جوین به بازی</button><button class="mgb-btn mgb-watch" id="mgbWatch">👀 فقط تماشا</button></div><button class="mgb-btn mgb-cancel" id="mgbCancel">❌ لغو</button><div class="mgb-note">با «جوین» بازیکن وارد همین اتاق می‌شود؛ با «تماشا» فقط ناظر خواهد بود.</div></div>`;
 document.body.appendChild(root);
 root.querySelector('#mgbJoin').onclick=()=>{socket?.emit('chooseGameOption',{fromId:d?.fromId,option:'join'});root.remove()};
 root.querySelector('#mgbWatch').onclick=()=>{socket?.emit('chooseGameOption',{fromId:d?.fromId,option:'watch'});root.remove()};
 root.querySelector('#mgbCancel').onclick=()=>root.remove();
}
function setLobbyBadge(){document.querySelectorAll('button,a,[role=button]').forEach(el=>{if(!/ورود به لابی بازیکنان آنلاین/.test(el.textContent||''))return;let b=el.querySelector('.morg-lobby-badge');if(!b){b=document.createElement('span');b.className='morg-lobby-badge';b.style.cssText='display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:12px;background:#e53935;color:#fff;margin-right:6px;font-size:.75rem';el.appendChild(b)}b.textContent=incoming.length||'';b.style.display=incoming.length?'inline-grid':'none'})}
function openLobby(){
 if(lobbyOpen)return;lobbyOpen=true;
 document.getElementById('morgOnlinePanel')?.remove();
 const old=document.getElementById('morgLobbyScreen');if(old)old.remove();
 const root=document.createElement('div');root.id='morgLobbyScreen';root.innerHTML=`<div class="mlg-wrap"><header class="mlg-head"><div><div class="mlg-title">👥 لابی بازیکنان آنلاین</div><div class="mlg-sub">بازیکنان آنلاین، درخواست‌های بازی و اتاق‌های فعال</div></div><button class="mlg-close" id="mrgClose">✕ بازگشت به بازی</button></header><nav class="mlg-tabs"><button class="mlg-tab active" data-tab="players">👥 بازیکنان آنلاین</button><button class="mlg-tab" data-tab="requests">📨 درخواست‌های بازی <span id="mrgReqBadge"></span></button><button class="mlg-tab" data-tab="rooms">🏠 اتاق‌های فعال</button></nav><main class="mlg-body" id="mrgLobbyBody"></main></div>`;
 document.body.appendChild(root);root.querySelector('#mrgClose').onclick=closeLobby;
 root.querySelectorAll('.mlg-tab').forEach(t=>t.onclick=()=>{root.querySelectorAll('.mlg-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');render(t.dataset.tab)});
 if(socket)socket.emit('getPlayerList');render('players');
}
function closeLobby(){document.getElementById('morgLobbyScreen')?.remove();lobbyOpen=false;setLobbyBadge()}
function render(tab='players'){
 if(!lobbyOpen)return;const body=document.getElementById('mrgLobbyBody');if(!body)return;
 const me=socket?.id;const players=online.filter(p=>p?.id&&p.id!==me);
 const req=incoming;
 document.getElementById('mrgReqBadge').innerHTML=req.length?`<span class="mlg-badge">${req.length}</span>`:'';
 if(tab==='players'){
  body.innerHTML=`<section class="mlg-section"><h2>🟢 بازیکنان آنلاین (${players.length})</h2><div class="mlg-grid" id="mrgPlayers"></div><button class="mlg-btn mlg-refresh" id="mrgRefresh">🔄 بروزرسانی لیست</button></section>`;
  const grid=document.getElementById('mrgPlayers');if(!players.length)grid.innerHTML='<div class="mlg-empty">بازیکن دیگری آنلاین نیست.</div>';
  players.forEach(p=>{const row=document.createElement('div');row.className='mlg-player';row.innerHTML=`<div class="mlg-info"><div class="mlg-avatar">${esc(p.avatar||'🐔')}</div><div><div class="mlg-name">${esc(p.name||'بازیکن')}</div><div class="mlg-meta"><span class="mlg-online">● آنلاین</span> · امتیاز ${esc(p.rating??'—')} · ${esc(p.status||'آماده')}</div></div></div><div class="mlg-actions"><button class="mlg-btn mlg-play">🎮 درخواست بازی</button></div>`;row.querySelector('.mlg-play').onclick=()=>socket?.emit('requestGame',{targetId:p.id});grid.appendChild(row)});document.getElementById('mrgRefresh').onclick=()=>socket?.emit('getPlayerList');
 }else if(tab==='requests'){
  body.innerHTML=`<section class="mlg-section"><h2>📨 درخواست‌های ورودی بازی ${req.length?`<span class="mlg-badge">${req.length}</span>`:''}</h2><div class="mlg-grid" id="mrgReqs"></div></section>`;const grid=document.getElementById('mrgReqs');if(!req.length)grid.innerHTML='<div class="mlg-empty">درخواستی ندارید.</div>';
  req.forEach((r,i)=>{const row=document.createElement('div');row.className='mlg-request';row.innerHTML=`<div class="mlg-info"><div class="mlg-avatar">${esc(r.avatar||r.fromAvatar||'🐔')}</div><div><div class="mlg-name">${esc(r.fromName||'بازیکن')}</div><div class="mlg-meta">نوع بازی: ${esc(r.gameType||'چندنفره')}</div></div></div><div class="mlg-actions"><button class="mlg-btn mlg-accept">✅ قبول</button><button class="mlg-btn mlg-reject">❌ رد کردن</button></div>`;row.querySelector('.mlg-accept').onclick=()=>{socket?.emit('acceptGame',{fromId:r.fromId});incoming.splice(i,1);render('requests')};row.querySelector('.mlg-reject').onclick=()=>{socket?.emit('rejectGame',{fromId:r.fromId});incoming.splice(i,1);render('requests')};grid.appendChild(row)});
 }else{
  const rooms={};online.filter(p=>p?.status==='room'||p?.status==='playing'||p?.status==='watching').forEach(p=>{const key=p.roomId||p.gameId||'بازی‌های فعال';(rooms[key]??=[]).push(p)});
  body.innerHTML=`<section class="mlg-section"><h2>🏠 اتاق‌های فعال</h2><div class="mlg-grid" id="mrgRooms"></div></section>`;const grid=document.getElementById('mrgRooms');const keys=Object.keys(rooms);if(!keys.length)grid.innerHTML='<div class="mlg-empty">در حال حاضر اتاق فعالی در لیست عمومی پیدا نشد.</div>';keys.forEach(k=>{const ps=rooms[k];const row=document.createElement('div');row.className='mlg-room';row.innerHTML=`<div><div class="mlg-name">🏠 ${esc(k)}</div><div class="mlg-meta">${ps.length} بازیکن/ناظر فعال</div></div><button class="mlg-btn mlg-watch">👀 مشاهده</button>`;row.querySelector('.mlg-watch').onclick=()=>{if(k&&k!=='بازی‌های فعال')socket?.emit('joinRoom',{roomId:k})};grid.appendChild(row)})
 }
 setLobbyBadge();
}
function hookButtons(){document.querySelectorAll('button,a,[role=button]').forEach(el=>{if(el.dataset.morgLobbyHook)return;if(!/ورود به لابی بازیکنان آنلاین/.test(el.textContent||''))return;el.dataset.morgLobbyHook='1';el.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openLobby()},true)});setLobbyBadge()}
function watch(){const s=getSocket();if(s)install(s);hookButtons()}
watch();setInterval(watch,500);
})();