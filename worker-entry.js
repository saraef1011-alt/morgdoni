import { GameRoom } from './worker-multi.js';
import app from './worker-multi.js';

// Keep the base room's disconnect grace period so a player can reconnect
// without immediately losing their seat, turn, or private-room membership.
export { GameRoom };
export default app;
