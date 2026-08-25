const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const rooms = {};

function createDeck() {
    let deck = [];
    for (let i = 0; i < 21; i++) deck.push('مرغ');
    for (let i = 0; i < 21; i++) deck.push('خروس');
    for (let i = 0; i < 12; i++) deck.push('لانه');
    for (let i = 0; i < 7; i++) deck.push('روباه');
    for (let i = 0; i < 3; i++) deck.push('تله');
    for (let i = 0; i < 2; i++) deck.push('مار');
    return shuffle(deck);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

io.on('connection', (socket) => {
    console.log('✅ کاربر متصل:', socket.id);

    socket.on('createRoom', ({ roomId, playerName }) => {
        if (rooms[roomId]) {
            socket.emit('roomError', 'اتاق قبلاً وجود دارد');
            return;
        }
        socket.join(roomId);
        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: playerName }],
            gameStarted: false,
            deck: createDeck(),
            eggTokens: 18,
            currentTurn: null,
            winner: null,
            discardPile: []
        };
        socket.emit('roomCreated', { roomId });
        io.to(roomId).emit('roomUpdate', rooms[roomId]);
        console.log(`🏠 اتاق ${roomId} ساخته شد`);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('roomError', 'اتاق پیدا نشد');
            return;
        }
        socket.join(roomId);
        room.players.push({ id: socket.id, name: playerName });
        io.to(roomId).emit('roomUpdate', rooms[roomId]);
        console.log(`🚪 ${playerName} به اتاق ${roomId} پیوست`);
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.host !== socket.id) return;
        
        room.gameStarted = true;
        room.players = room.players.map(p => ({
            id: p.id,
            name: p.name,
            hand: [],
            eggs: 0,
            chicks: 0
        }));
        room.players.forEach(p => {
            for (let i = 0; i < 4; i++) {
                if (room.deck.length > 0) p.hand.push(room.deck.pop());
            }
        });
        room.currentTurn = room.players[0].id;
        io.to(roomId).emit('gameState', room);
        console.log(`🎮 بازی در اتاق ${roomId} شروع شد`);
    });

    socket.on('getGameState', ({ roomId }) => {
        const room = rooms[roomId];
        if (room) {
            socket.emit('gameState', room);
        }
    });

    socket.on('gameAction', ({ roomId, action, data }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.currentTurn !== socket.id) return;

        let actionDone = false;
        
        switch (action) {
            case 'lay': {
                const henIdx = player.hand.indexOf('مرغ');
                const roosterIdx = player.hand.indexOf('خروس');
                const nestIdx = player.hand.indexOf('لانه');
                if (henIdx !== -1 && roosterIdx !== -1 && nestIdx !== -1 && room.eggTokens > 0) {
                    player.hand.splice(henIdx, 1);
                    player.hand.splice(roosterIdx, 1);
                    player.hand.splice(nestIdx, 1);
                    player.eggs++;
                    room.eggTokens--;
                    actionDone = true;
                }
                break;
            }
            case 'hatch': {
                const hens = player.hand.filter(c => c === 'مرغ').length;
                if (hens >= 2 && player.eggs > 0) {
                    let removed = 0;
                    for (let i = 0; i < player.hand.length && removed < 2; i++) {
                        if (player.hand[i] === 'مرغ') {
                            player.hand.splice(i, 1);
                            i--;
                            removed++;
                        }
                    }
                    player.eggs--;
                    player.chicks++;
                    actionDone = true;
                }
                break;
            }
            case 'fox': {
                const foxIdx = player.hand.indexOf('روباه');
                if (foxIdx === -1) break;
                const opponent = room.players.find(p => p.id !== socket.id);
                if (!opponent || opponent.eggs === 0) break;
                player.hand.splice(foxIdx, 1);
                if (opponent.hand.filter(c => c === 'خروس').length >= 2) {
                    let removed = 0;
                    for (let i = 0; i < opponent.hand.length && removed < 2; i++) {
                        if (opponent.hand[i] === 'خروس') {
                            opponent.hand.splice(i, 1);
                            i--;
                            removed++;
                        }
                    }
                } else {
                    opponent.eggs--;
                    player.eggs++;
                }
                actionDone = true;
                break;
            }
            case 'snake': {
                const snakeIdx = player.hand.indexOf('مار');
                if (snakeIdx === -1) break;
                const opponent = room.players.find(p => p.id !== socket.id);
                if (!opponent || opponent.eggs === 0) break;
                const count = data?.count || 1;
                player.hand.splice(snakeIdx, 1);
                const broken = Math.min(opponent.eggs, count);
                opponent.eggs -= broken;
                room.eggTokens += broken;
                actionDone = true;
                break;
            }
            case 'trap': {
                const trapIdx = player.hand.indexOf('تله');
                if (trapIdx === -1) break;
                const opponent = room.players.find(p => p.id !== socket.id);
                if (!opponent) break;
                const cardName = data?.card;
                if (!cardName || !opponent.hand.includes(cardName)) break;
                player.hand.splice(trapIdx, 1);
                const ridx = opponent.hand.indexOf(cardName);
                if (ridx !== -1) opponent.hand.splice(ridx, 1);
                actionDone = true;
                break;
            }
            case 'draw': {
                if (room.deck.length > 0) {
                    player.hand.push(room.deck.pop());
                    actionDone = true;
                }
                break;
            }
            // ===== کیس باطل کردن کارت =====
            case 'discard': {
                const cardToDiscard = data?.card;
                if (!cardToDiscard) break;
                const cardIndex = player.hand.indexOf(cardToDiscard);
                if (cardIndex === -1) break;
                const removed = player.hand.splice(cardIndex, 1)[0];
                if (!room.discardPile) room.discardPile = [];
                room.discardPile.push(removed);
                actionDone = true;
                console.log(`🗑️ ${player.name} کارت ${removed} را باطل کرد`);
                break;
            }
            case 'endTurn': {
                actionDone = true;
                break;
            }
        }
        
        if (actionDone) {
            while (player.hand.length < 4 && room.deck.length > 0) {
                player.hand.push(room.deck.pop());
            }
            if (room.deck.length === 0 && room.discardPile?.length > 0) {
                room.deck = shuffle([...room.discardPile]);
                room.discardPile = [];
            }
            for (let p of room.players) {
                if (p.chicks >= 3) {
                    room.winner = p.id;
                    break;
                }
            }
            if (!room.winner) {
                const currentIdx = room.players.findIndex(p => p.id === room.currentTurn);
                const nextIdx = (currentIdx + 1) % room.players.length;
                room.currentTurn = room.players[nextIdx].id;
            }
            io.to(roomId).emit('gameState', room);
        }
    });

    socket.on('chatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        io.to(roomId).emit('chatMessage', {
            sender: player.name,
            message: message,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(roomId).emit('roomUpdate', rooms[roomId]);
                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('🐔 سرور مرغ دونی روشن شد');
    console.log(`🌐 http://localhost:${PORT}`);
});