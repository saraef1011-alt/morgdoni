class MorgdoniSocket {
  constructor() {
    this.events = {};
    this.id = null;
    this.queue = [];
    this.heartbeat = null;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(scheme + '//' + location.host + '/ws');
    this.ws.onopen = () => {
      this.emitLocal('connect');
      this.heartbeat = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }, 10000);
      for (const message of this.queue) this.ws.send(message);
      this.queue = [];
    };
    this.ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (!message?.type) return;
        if (message.type === 'hello' && message.data?.id) {
          this.id = message.data.id;
          window.myId = message.data.id;
        }
        this.emitLocal(message.type, message.data);
      } catch (error) { console.error(error); }
    };
    this.ws.onclose = () => { clearInterval(this.heartbeat); this.emitLocal('disconnect'); };
    this.ws.onerror = error => this.emitLocal('connect_error', error);
  }
  on(event, callback) { (this.events[event] ??= []).push(callback); return this; }
  once(event, callback) { const wrapper = data => { this.off(event, wrapper); callback(data); }; return this.on(event, wrapper); }
  off(event, callback) { this.events[event] = (this.events[event] || []).filter(fn => fn !== callback); return this; }
  emit(event, data) {
    const message = JSON.stringify({ type: event, data: data ?? null });
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(message); else this.queue.push(message);
    return this;
  }
  emitLocal(event, data) { for (const callback of this.events[event] || []) { try { callback(data); } catch (error) { console.error(error); } } }
  disconnect() { clearInterval(this.heartbeat); this.ws?.close(); }
}
window.io = window.io || function() {
  const socket = new MorgdoniSocket();
  window.__MORG_SOCKET__ = socket;
  return socket;
};
