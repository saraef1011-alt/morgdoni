const rooms=new Map();
const DECK=[];
for(const [type,count] of [['chicken',21],['rooster',21],['nest',12],['fox',7],['trap',3],['snake',2]])for(let i=0;i<count;i++)DECK.push(type);
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function code(){return Math.random().toString(36).slice(2,7).toUpperCase()}
function room(c){if(!rooms.has(c))rooms.set(c,{players:[],deck:shuffle([...DECK]),turn:0,started:false,hands:{}});return rooms.get(c)}
function pub(r){return {players:r.players.map(p=>({id:p.id,name:p.name})),currentPlayer:r.players[r.turn]?.name||'',started:r.started}}
function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj))}
function broadcast(r,obj){r.players.forEach(p=>send(p.ws,obj))}
function stateFor(r,p){return {players:r.players.map(x=>({id:x.id,name:x.name})),currentPlayer:r.players[r.turn]?.name||'',started:r.started,hand:r.hands[p.id]||[]}}
export function handle(ws,msg){
 let d;try{d=JSON.parse(msg)}catch{return send(ws,{type:'error',text:'پیام نامعتبر'})}
 if(d.type==='create'){let c=code();while(rooms.has(c))c=code();let r=room(c);if(r.players.length>=2)return;const p={id:crypto.randomUUID(),name:String(d.name||'بازیکن').slice(0,30),ws};p.room=c;r.players.push(p);r.hands[p.id]=[];ws._player=p;send(ws,{type:'message',text:'اتاق ساخته شد: '+c});broadcast(r,{type:'state',state:stateFor(r,p)});return}
 if(d.type==='join'){const c=String(d.roomCode||'').toUpperCase();const r=rooms.get(c);if(!r)return send(ws,{type:'error',text:'اتاق پیدا نشد'});if(r.players.length>=2)return send(ws,{type:'error',text:'اتاق پر است'});const p={id:crypto.randomUUID(),name:String(d.name||'بازیکن').slice(0,30),ws};p.room=c;r.players.push(p);r.hands[p.id]=[];ws._player=p;if(r.players.length===2){r.started=true;r.turn=0;for(const x of r.players)for(let i=0;i<5;i++)r.hands[x.id].push(r.deck.pop());}for(const x of r.players)send(x.ws,{type:'state',state:stateFor(r,x)});return}
 const p=ws._player;if(!p||!p.room)return send(ws,{type:'error',text:'ابتدا وارد اتاق شوید'});const r=rooms.get(p.room);if(d.type==='quick'){return}
 if(d.type==='action'){if(!r.started)return send(ws,{type:'error',text:'بازی هنوز دو نفره نشده'});if(r.players[r.turn].id!==p.id)return send(ws,{type:'error',text:'نوبت شما نیست'});if(d.action==='draw'){if(r.deck.length)r.hands[p.id].push(r.deck.pop())}else if(d.action==='playCard'){const i=Number(d.index);if(i>=0&&i<r.hands[p.id].length){const card=r.hands[p.id].splice(i,1)[0];broadcast(r,{type:'message',text:p.name+' کارت '+card+' را بازی کرد'})}}else if(d.action==='endTurn'){r.turn=(r.turn+1)%r.players.length}for(const x of r.players)send(x.ws,{type:'state',state:stateFor(r,x)})}
}
export function disconnect(ws){const p=ws._player;if(!p)return;const r=rooms.get(p.room);if(!r)return;r.players=r.players.filter(x=>x.id!==p.id);delete r.hands[p.id];if(r.players.length===0)rooms.delete(p.room);else{r.started=false;r.turn=0;broadcast(r,{type:'message',text:'بازیکن از اتاق خارج شد'});broadcast(r,{type:'state',state:stateFor(r,r.players[0])})}}
