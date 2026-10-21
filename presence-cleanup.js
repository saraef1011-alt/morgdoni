// پاک‌سازی کامل بازیکن قطع‌شده از حضور آنلاین، اتاق، صف و درخواست‌ها.
export async function cleanupDisconnectedPlayer(room, id) {
  if (!room || !id) return;
  await room.ready;

  const pending = room.data.pending?.[id] || [];
  for (const req of pending) {
    if (room.data.online?.[req.fromId]) {
      if (room.data.online[req.fromId].status === 'requesting') room.data.online[req.fromId].status = 'ready';
      room.send(req.fromId, 'gameRequestCancelled', { reason: 'طرف مقابل قطع شد' });
    }
  }
  delete room.data.pending[id];

  for (const targetId of Object.keys(room.data.pending || {})) {
    const arr = room.data.pending[targetId] || [];
    const kept = arr.filter(x => x.fromId !== id);
    if (kept.length !== arr.length) {
      room.data.pending[targetId] = kept;
      room.send(targetId, 'gameRequestCancelled', { reason: 'طرف مقابل قطع شد' });
    }
    if (!room.data.pending[targetId]?.length) delete room.data.pending[targetId];
  }

  const cur = room.roomOf(id);
  if (cur) {
    const r = cur.room;
    r.players = (r.players || []).filter(p => p.id !== id);
    r.watchers = (r.watchers || []).filter(x => x !== id);
    if (!r.players.length) {
      delete room.data.rooms[cur.roomId];
    } else {
      if (r.host === id) r.host = r.players[0].id;
      if (r.currentTurn === id) r.currentTurn = r.players[0].id;
      room.roomBroadcast(r, 'roomUpdate', r);
      room.roomBroadcast(r, 'gameState', r);
      room.roomBroadcast(r, 'webrtc-peer-left', { peerId: id });
    }
  }

  delete room.data.online[id];
  room.data.queue = (room.data.queue || []).filter(x => x !== id);
  room.sessions.delete(id);
  room.updateList();
  await room.save();
}