import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("🐔 مرغ دونی روشن است", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/ws" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const roomId = url.searchParams.get("room") || "main";
      const id = env.GAME_ROOM.idFromName(roomId);
      return env.GAME_ROOM.get(id).fetch(request);
    }
    return new Response("مرغ دونی 🐔");
  }
};

export class GameRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.broadcast({ type: "server", data: { message: "🐔 بازیکن جدید وارد اتاق شد" } });
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    let packet;
    try { packet = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch { ws.send(JSON.stringify({ type: "error", data: { message: "پیام نامعتبر است" } })); return; }
    this.broadcast(packet);
  }
  webSocketClose() { this.broadcast({ type: "server", data: { message: "👋 یک بازیکن از اتاق خارج شد" } }); }
  webSocketError(ws) { try { ws.close(1011, "WebSocket error"); } catch {} }
  broadcast(data) {
    const message = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) try { ws.send(message); } catch {}
  }
}
