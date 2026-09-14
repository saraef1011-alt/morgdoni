import { GameRoom as MultiGameRoom } from './worker-multi.js';
import app from './worker-multi.js';

export class GameRoom extends MultiGameRoom {
  async close(id) {
    this.sessions.delete(id);
    delete this.data.online[id];
    this.updateList();
    await this.save();
  }
}

export default app;
