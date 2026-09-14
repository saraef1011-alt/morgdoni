import { GameRoom as MultiGameRoom } from './worker-multi.js';
import app from './worker-multi.js';

// Fix: remove a player from the online/lobby list as soon as their WebSocket closes.
// worker.js calls this.close(id) from its WebSocket close handler, but the base class
// did not provide the cleanup method. Keeping the fix in this wrapper avoids touching
// the game logic itself.
export class GameRoom extends MultiGameRoom {
  async close(id) {
    this.sessions.delete(id);

    // Remove this connection from matchmaking/requests.
    delete this.data.online[id];
    delete this.data.pending[id];
    for (const key of Object.keys(this.data.pending || {})) {
      this.data.pending[key] = (this.data.pending[key] || []).filter(x => x.fromId !== id);
      if (!this.data.pending[key].length) delete this.data.pending[key];
    }
    this.data.queue = (this.data.queue || []).filter(x => x !== id);

    // Remove the player/watcher from every room and keep the remaining room state valid.
    for (const [rid, r] of Object.entries(this.data.rooms || {})) {
      const wasPlayer = (r.players || []).some(p => p.id === id);
      const wasWatcher = (r.watchers || []).includes(id);
      if (!wasPlayer && !wasWatcher) continue;

      r.players = (r.players || []).filter(p => p.id !== id);
      r.watchers = (r.watchers || []).filter(x => x !== id);

      if (r.host === id && r.players.length) r.host = r.players[0].id;

      if (r.currentTurn === id && r.players.length) {
        r.currentTurn = r.players[0].id;
      }

      if (!r.players.length) {
        delete this.data.rooms[rid];
      } else {
        this.roomBroadcast(r, 'roomUpdate', r);
        this.roomBroadcast(r, 'gameState', r);
      }
    }

    // Immediately refresh the lobby for every connected client.
    this.updateList();
    await this.save();
  }
}

export default app;
