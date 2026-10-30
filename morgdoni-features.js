(()=>{'use strict';
const KEY='morgdoni.profile.v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sock=null, players=2, lastHistory=[];
function profile(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}}
function saveProfile(p){try{localStorage.setItem(KEY,JSON.stringify(p))}catch{}}
function socket(){return window.__MORG_SOCKET__||window.socket||null}
const css=`
#morg-feature-launcher{position:fixed;left:14px;bottom:14px;z-index:100001;border:2px solid #ffe0a0;border-radius:18px;padding:12px 16px;background:linear-gradient(145deg,#6b351e,#3b2115);color:#fff5d6;font-weight:900;box-shadow:0 6px 0 #24130c;cursor:pointer}
#morg-feature-panel{position:fixed;inset:0;z-index:100002;background:#120d0bd9;display:none;align-items:center;justify-content:center;padding:14px;direction:rtl;font-family:Tahoma,'Segoe UI',sans-serif}
#morg-feature-panel .mfp-box{width:min(760px,100%);max-height:92vh;overflow:auto;background:linear-gradient(145deg,#fff9e9,#f0d3a1);border:3px solid #d89a45;border-radius:26px;padding:18px;box-shadow:0 24px 80px #0009;color:#4b2917}
#morg-feature-panel h2{margin:0 0 12px;font-size:24px}#morg-feature-panel h3{margin:12px 0 8px}
#morg-feature-panel .mfp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
#morg-feature-panel button,#morg-feature-panel input,#morg-feature-panel select{font:inherit}
#morg-feature-panel .mfp-btn{border:0;border-radius:13px;padding:11px 12px;background:#6b351e;color:white;font-weight:800;cursor:pointer;box-shadow:0 4px 0 #3b2115}
#morg-feature-panel .mfp-btn.gold{background:#d98928;color:#2d1a0d;box-shadow:0 4px 0 #8b4b16}
#morg-feature-panel .mfp-btn.green{background:#21864a;box-shadow:0 4px 0 #14542e}
#morg-feature-panel .mfp-btn.red{background:#b63a2b;box-shadow:0 4px 0 #702019}
#morg-feature-panel .mfp-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
#morg-feature-panel input,#morg-feature-panel select{min-width:0;flex:1;border:2px solid #d4a56b;border-radius:12px;padding:10px;background:#fffdf6;color:#432615}
#morg-feature-panel .mfp-card{background:#fffdf5;border:1px solid #e0bd85;border-radius:15px;padding:12px;margin:8px 0}
#morg-feature-panel .mfp-close{float:left;border:0;border-radius:50%;width:38px;height:38px;background:#b63a2b;color:#fff;font-size:23px;font-weight:900;cursor:pointer}
#morg-feature-panel .mfp-muted{font-size:13px;line-height:1.7;color:#79563a}
#morg-feature-panel .mfp-stickers{display:flex;flex-wrap:wrap;gap:7px}
#morg-feature-panel .mfp-stickers button{font-size:26px;border:1px solid #e0bd85;border-radius:12px;background:#fff;padding:8px;cursor:pointer}
#morg-feature-panel .mfp-vs{display:flex;align-items:center;justify-content:center;gap:16px;font-size:22px;font-weight:900;background:#4b2917;color:#ffe4a6;border-radius:18px;padding:18px}
#morg-feature-panel .mfp-vs span{font-size:38px}
#morg-feature-panel .mfp-wheel{margin:14px auto;width:145px;height:145px;border-radius:50%;border:8px solid #d99a3e;background:conic-gradient(#f7d16b 0 45deg,#fff2c8 45deg 90deg,#e9a441 90deg 135deg,#fff2c8 135deg 180deg,#f7d16b 180deg 225deg,#fff2c8 225deg 270deg,#e9a441 270deg 315deg,#fff2c8 315deg);display:flex;align-items:center;justify-content:center;font-size:36px;box-shadow:0 8px 0 #75421e}
@media(max-width:540px){#morg-feature-panel .mfp-grid{grid-template-columns:1fr}#morg-feature-launcher{left:8px;bottom:8px;font-size:13px;padding:10px}}
`;
function injectStyle(){if(document.getElementById('morg-feature-style'))return;const s=document.createElement('style');s.id='morg-feature-style';s.textContent=css;document.head.appendChild(s)}
function emit(type,data){const s=socket();if(!s){alert('اتصال بازی هنوز آماده نیست؛ چند ثانیه صبر کن.');return false}s.emit(type,data||{});return true}
function roomId(){return String(window.roomId||window.currentRoomId||document.querySelector('[data-room-id]')?.dataset.roomId||'').toUpperCase()}
function openPanel(){const p=document.getElementById('morg-feature-panel');if(p)p.style.display='flex'}
function closePanel(){const p=document.getElementById('morg-feature-panel');if(p)p.style.display='none'}
function render(){injectStyle();if(!document.getElementById('morg-feature-launcher')){const b=document.createElement('button');b.id='morg-feature-launcher';b.textContent='🐔 امکانات بازی';b.onclick=openPanel;document.body.appendChild(b)}
if(document.getElementById('morg-feature-panel'))return;
const p=document.createElement('div');p.id='morg-feature-panel';p.innerHTML=`<div class="mfp-box"><button class="mfp-close" id="mfp-close">×</button><h2>🐔 مرکز امکانات مرغ‌دونی</h2><p class="mfp-muted">لابی، اتاق خصوصی، حریف هوشمند، پروفایل، استیکر و امکانات مسابقه از اینجا در دسترس‌اند.</p>
<div class="mfp-grid">
<button class="mfp-btn green" id="mfp-quick">⚡ بازی سریع</button><button class="mfp-btn" id="mfp-ai">🤖 بازی با هوش مصنوعی</button>
<button class="mfp-btn gold" id="mfp-create">🔐 ساخت اتاق خصوصی</button><button class="mfp-btn" id="mfp-join">🚪 ورود با کد اتاق</button>
<button class="mfp-btn" id="mfp-profile">👤 پروفایل بازیکن</button><button class="mfp-btn" id="mfp-history">🏆 تاریخچه و رتبه</button>
<button class="mfp-btn gold" id="mfp-mirror">🪞 آینهٔ گردان</button><button class="mfp-btn" id="mfp-stickers">😄 استیکر سریع</button>
</div><div id="mfp-detail" class="mfp-card" aria-live="polite">یک امکان را انتخاب کن.</div><p class="mfp-muted">بازی سریع از ۲ تا ۱۰ نفر پشتیبانی می‌کند. شروع مسابقه به آنلاین بودن تعداد کافی بازیکن وابسته است.</p></div>`;
document.body.appendChild(p);p.querySelector('#mfp-close').onclick=closePanel;
p.querySelector('#mfp-quick').onclick=()=>{detail(`<h3>⚡ بازی سریع</h3><p>تعداد بازیکنان مسابقه را انتخاب کن:</p><div class="mfp-row"><select id="mfp-count">${Array.from({length:9},(_,i)=>`<option value="${i+2}" ${i===0?'selected':''}>${i+2} بازیکن</option>`).join('')}</select><button class="mfp-btn green" id="mfp-queue">پیدا کردن بازی</button><button class="mfp-btn red" id="mfp-cancel">لغو صف</button></div><div id="mfp-queue-status" class="mfp-muted"></div>`);document.getElementById('mfp-queue').onclick=()=>{const n=Number(document.getElementById('mfp-count').value)||2;emit('quickGame',{players:n});document.getElementById('mfp-queue-status').textContent='در حال پیدا کردن بازیکن‌ها…';};document.getElementById('mfp-cancel').onclick=()=>{emit('cancelQuickGame',{});document.getElementById('mfp-queue-status').textContent='درخواست لغو صف ارسال شد.';};};
p.querySelector('#mfp-ai').onclick=()=>{detail('<h3>🤖 حریف هوشمند</h3><p>یک مسابقهٔ تک‌نفره در برابر مرغ‌دونی هوشمند بساز.</p><button class="mfp-btn green" id="mfp-start-ai">شروع بازی با هوش مصنوعی</button>');document.getElementById('mfp-start-ai').onclick=()=>emit('playWithAI',{});};
p.querySelector('#mfp-create').onclick=()=>{detail('<h3>🔐 ساخت اتاق خصوصی</h3><p>یک کد کوتاه برای دوستت ساخته می‌شود.</p><button class="mfp-btn gold" id="mfp-create-room">ساخت اتاق و دریافت کد</button><div id="mfp-room-result" class="mfp-muted"></div>');document.getElementById('mfp-create-room').onclick=()=>{const pr=profile();emit('createRoom',{playerName:pr.username||'بازیکن',avatar:pr.avatar||'🐔'});document.getElementById('mfp-room-result').textContent='درخواست ساخت اتاق ارسال شد؛ کد در پیام roomCreated نمایش داده می‌شود.';};};
p.querySelector('#mfp-join').onclick=()=>{detail('<h3>🚪 ورود به اتاق</h3><div class="mfp-row"><input id="mfp-room-code" maxlength="8" placeholder="کد اتاق مثل ABC123"/><button class="mfp-btn green" id="mfp-join-room">ورود</button></div>');document.getElementById('mfp-join-room').onclick=()=>{const rid=document.getElementById('mfp-room-code').value.trim().toUpperCase();if(rid)emit('joinRoom',{roomId:rid,playerName:profile().username||'بازیکن'});};};
p.querySelector('#mfp-profile').onclick=()=>{const pr=profile();detail(`<h3>👤 پروفایل</h3><div class="mfp-row"><input id="mfp-name" maxlength="20" placeholder="نام کاربری" value="${esc(pr.username||'')}" /><select id="mfp-avatar"><option>🐔</option><option>🐓</option><option>🦊</option><option>🐣</option><option>🐍</option><option>🦉</option><option>🐼</option><option>🐸</option></select><button class="mfp-btn green" id="mfp-save-profile">ذخیره</button></div><div class="mfp-muted">پروفایل محلی برای حفظ نام و آواتار در همین مرورگر ذخیره می‌شود.</div>`);document.getElementById('mfp-avatar').value=pr.avatar||'🐔';document.getElementById('mfp-save-profile').onclick=()=>{const next={username:document.getElementById('mfp-name').value.trim().slice(0,20),avatar:document.getElementById('mfp-avatar').value};if(next.username.length<2){alert('نام کاربری باید حداقل ۲ حرف داشته باشد.');return}saveProfile(next);emit('saveProfile',{accountId:pr.accountId||localAccount(),username:next.username,avatar:next.avatar});emit('registerPlayer',{accountId:pr.accountId||localAccount(),playerName:next.username,avatar:next.avatar});detail('<b>پروفایل ذخیره شد.</b>');};};
p.querySelector('#mfp-history').onclick=()=>{detail('<h3>🏆 تاریخچهٔ مسابقات</h3><button class="mfp-btn" id="mfp-load-history">بارگذاری تاریخچه</button><div id="mfp-history-list" class="mfp-muted"></div>');document.getElementById('mfp-load-history').onclick=()=>{emit('getHistory',{});document.getElementById('mfp-history-list').textContent='در حال بارگذاری…';};};
p.querySelector('#mfp-mirror').onclick=()=>{detail('<h3>🪞 آینهٔ گردان</h3><div class="mfp-wheel" id="mfp-wheel">🐔</div><button class="mfp-btn gold" id="mfp-spin">چرخاندن آینه</button><p class="mfp-muted">این بخش برای انتخاب تصادفی افکت/استیکر تزئینی است و روی نتیجهٔ بازی اثر ندارد.</p>');document.getElementById('mfp-spin').onclick=()=>{const w=document.getElementById('mfp-wheel');w.style.transition='transform 2.2s cubic-bezier(.1,.8,.15,1)';w.style.transform='rotate('+((4+Math.floor(Math.random()*5))*360+Math.floor(Math.random()*360))+'deg)';setTimeout(()=>{w.textContent=['🐔','🦊','🐣','🥚','✨','🐓','🎉'][Math.floor(Math.random()*7)];},2100);};};
p.querySelector('#mfp-stickers').onclick=()=>{detail('<h3>😄 استیکر سریع</h3><p class="mfp-muted">استیکر به بازیکنان داخل اتاق فعلی ارسال می‌شود.</p><div class="mfp-stickers">'+['😂','🐔','🦊','🐣','🥚','😎','👏','😮','🎉','💚','🐓','🙈'].map(v=>'<button type="button" data-sticker="'+v+'">'+v+'</button>').join('')+'</div>');document.querySelectorAll('[data-sticker]').forEach(b=>b.onclick=()=>{const rid=roomId();if(!rid){alert('برای ارسال استیکر ابتدا وارد یک اتاق بازی شو.');return}emit('chatSticker',{roomId:rid,message:b.dataset.sticker});});};
}
function detail(html){const d=document.getElementById('mfp-detail');if(d)d.innerHTML=html}
function localAccount(){const p=profile();if(p.accountId)return p.accountId;const id='morg-'+Math.random().toString(36).slice(2)+Date.now().toString(36);saveProfile({...p,accountId:id});return id}
function install(s){if(!s||s.__morgFeaturesInstalled)return;s.__morgFeaturesInstalled=true;sock=s;
const pr=profile();if(pr.username){s.emit('registerPlayer',{accountId:pr.accountId||localAccount(),playerName:pr.username,avatar:pr.avatar||'🐔'});}
s.on('hello',d=>{if(d?.id)window.myId=d.id;const p=profile();if(p.username)s.emit('registerPlayer',{accountId:p.accountId||localAccount(),playerName:p.username,avatar:p.avatar||'🐔'});});
s.on('roomCreated',d=>{if(d?.roomId){window.roomId=d.roomId;detail('<b>اتاق ساخته شد!</b><div class="mfp-vs"><span>🔐</span><div>کد اتاق<br>'+esc(d.roomId)+'</div></div><button class="mfp-btn gold" id="mfp-copy-code">کپی کد اتاق</button>');const b=document.getElementById('mfp-copy-code');if(b)b.onclick=()=>navigator.clipboard?.writeText(d.roomId).then(()=>b.textContent='کپی شد').catch(()=>{});}});
s.on('roomJoined',d=>{if(d?.roomId)window.roomId=d.roomId;});
s.on('joinExistingGame',d=>{if(d?.roomId)window.roomId=d.roomId;});
s.on('gameStarted',d=>{if(d?.roomId)window.roomId=d.roomId;const ps=d?.players||[];if(ps.length>=2){const vs=document.createElement('div');vs.id='mfp-vs-toast';vs.className='mfp-vs';vs.style.cssText='position:fixed;inset:20px 10px auto;max-width:560px;margin:auto;z-index:100003;box-shadow:0 12px 40px #0008';vs.innerHTML='<span>'+esc(ps[0].avatar||'🐔')+'</span><div>'+esc(ps[0].name||'بازیکن')+'<br>VS<br>'+esc(ps[1].name||'حریف')+'</div><span>'+esc(ps[1].avatar||'🐔')+'</span>';document.body.appendChild(vs);setTimeout(()=>vs.remove(),2600);}});
s.on('quickGameQueued',d=>{const el=document.getElementById('mfp-queue-status');if(el)el.textContent='در صف: '+(d?.found||0)+' از '+(d?.players||players)+' بازیکن پیدا شده‌اند.';});
s.on('quickGameError',d=>alert(String(d||'بازی سریع انجام نشد')));
s.on('roomError',d=>alert(String(d||'اتاق در دسترس نیست')));
s.on('profileData',d=>{if(d?.profile){const old=profile();saveProfile({...old,accountId:d.profile.accountId||old.accountId,username:d.profile.username||old.username,avatar:d.profile.avatar||old.avatar,stats:{gamesPlayed:d.profile.gamesPlayed||0,wins:d.profile.wins||0,losses:d.profile.losses||0}})}});
s.on('historyData',d=>{const el=document.getElementById('mfp-history-list');if(!el)return;const list=Array.isArray(d?.history)?d.history:[];el.innerHTML=list.length?list.slice(0,20).map(h=>'<div class="mfp-card">'+esc(new Date(h.time||Date.now()).toLocaleString())+' — '+esc(h.winnerName||'برنده نامشخص')+' <span>🏆</span><br><small>'+esc((h.players||[]).map(p=>p.name).join('، '))+'</small></div>').join(''):'هنوز مسابقه‌ای ثبت نشده است.';});
}
function hook(){const s=socket();if(s)install(s);render()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook);else hook();
setInterval(hook,500);
})();