class MorgdoniSocket {
  constructor() {
    this.events = {};
    this.id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const room = new URLSearchParams(location.search).get("room") || "main";

    this.ws = new WebSocket(`${protocol}//${location.host}/ws?room=${encodeURIComponent(room)}`);

    this.ws.addEventListener("open", () => {
      this.emitLocal("connect");
      console.log("🐔 اتصال مرغ دونی برقرار شد");
    });

    this.ws.addEventListener("message", event => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (!packet || !packet.type) return;
      this.emitLocal(packet.type, packet.data, packet);
    });

    this.ws.addEventListener("close", () => {
      this.emitLocal("disconnect");
      console.log("اتصال مرغ دونی قطع شد");
    });

    this.ws.addEventListener("error", error => {
      console.error("خطای WebSocket:", error);
      this.emitLocal("connect_error", error);
    });
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
    return this;
  }

  emit(event, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket هنوز متصل نیست:", event);
      return;
    }
    this.ws.send(JSON.stringify({ type: event, data: data ?? null }));
  }

  emitLocal(event, data, fullData) {
    const callbacks = this.events[event] || [];
    callbacks.forEach(callback => {
      try { callback(data !== undefined ? data : fullData); }
      catch (error) { console.error(`خطا در رویداد ${event}:`, error); }
    });
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}

window.io = function () {
  return new MorgdoniSocket();
};
