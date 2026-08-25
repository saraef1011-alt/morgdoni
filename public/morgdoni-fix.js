(() => {
  const cardMap = {
    'مرغ':'chicken.svg','خروس':'rooster.svg','لانه':'nest.svg',
    'روباه':'fox.svg','مار':'snake.svg','تله':'trap.svg'
  };
  window.getIcon = function(c){
    const f = cardMap[c];
    return f ? `<img class="card-art" src="/assets/cards/${f}?v=4" alt="${c}">` : '🃏';
  };
  window.sendSharedGif = function(){
    if (!window.socket || !window.roomId) { alert('ابتدا وارد بازی شو.'); return; }
    const stickers = ['🐔🎉','😂🐓','🦊😎','🐍😱','🥚🔥'];
    const content = stickers[Math.floor(Math.random()*stickers.length)];
    window.socket.emit('chatMedia',{roomId:window.roomId,kind:'sticker',content,name:'sticker',mime:'text/plain',size:content.length});
  };
})();
