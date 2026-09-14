import { GameRoom as MultiGameRoom } from './worker-multi.js';
import app from './worker-multi.js';

export class GameRoom extends MultiGameRoom {
  async close(id) {
    this.sessions.delete(id);
    delete this.data.online[id];
    delete this.data.pending[id];
    for (const key of Object.keys(this.data.pending || {})) {
      this.data.pending[key] = (this.data.pending[key] || []).filter(x => x.fromId !== id);
      if (!this.data.pending[key].length) delete this.data.pending[key];
    }
    this.data.queue = (this.data.queue || []).filter(x => x !== id);

    for (const [rid, r] of Object.entries(this.data.rooms || {})) {
      const wasPlayer = (r.players || []).some(p => p.id === id);
      const wasWatcher = (r.watchers || []).includes(id);
      if (!wasPlayer && !wasWatcher) continue;

      r.players = (r.players || []).filter(p => p.id !== id);
      r.watchers = (r.watchers || []).filter(x => x !== id);
      if (r.host === id && r.players.length) r.host = r.players[0].id;
      if (r.currentTurn === id && r.players.length) r.currentTurn = r.players[0].id;

      if (!r.players.length) {
        delete this.data.rooms[rid];
      } else {
        this.roomBroadcast(r, 'roomUpdate', r);
        this.roomBroadcast(r, 'gameState', r);
      }
    }

    this.updateList();
    await this.save();
  }
}

export default app;
