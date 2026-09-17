import { GameRoom as MultiGameRoom } from './worker-multi.js';
import { cleanupDisconnectedPlayer } from './presence-cleanup.js';
import app from './worker-multi.js';

export class GameRoom extends MultiGameRoom {
  async close(id) {
    await cleanupDisconnectedPlayer(this, id);
  }
}

export default app;
