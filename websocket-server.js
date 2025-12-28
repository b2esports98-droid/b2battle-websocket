/**
 * Tournament WebSocket Server
 * Windows-safe, Redis-v4-stable, env-driven
 *
 * Usage:
 *   node websocket-server.js
 */

require('dotenv').config({
    path: require('fs').existsSync('.env.local') ? '.env.local' : '.env'
});

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ================= CONFIG ================= */

const PORT = Number(process.env.WEBSOCKET_PORT) || 8081;

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT
    ? Number(process.env.REDIS_PORT)
    : 6379;

const REDIS_ENABLED = Boolean(REDIS_HOST && REDIS_PORT);

const EVENT_DIR = path.resolve(
    __dirname,
    process.env.WEBSOCKET_EVENTS_DIR || 'var/websocket_events'
);

const REDIS_RETRY_INTERVAL = 5000;

/* ================= WEBSOCKET ================= */

const server = http.createServer();
const wss = new WebSocket.Server({
    server,
    path: '/ws/tournaments',
    verifyClient: () => true
});

const clients = new Set();

wss.on('connection', ws => {
    clients.add(ws);
    console.log(`✅ Client connected (${clients.size})`);

    ws.send(JSON.stringify({
        event: 'connected',
        payload: { message: 'Connected to tournament WebSocket server' }
    }));

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`❌ Client disconnected (${clients.size})`);
    });

    ws.on('error', () => {
        clients.delete(ws);
    });
});

function broadcast(event) {
    const message = JSON.stringify(event);
    let sent = 0;
    let failed = 0;

    console.log(`\n📢 ===== BROADCASTING TO CLIENTS =====`);
    console.log(`Event: ${event.event}`);
    console.log(`Total clients: ${clients.size}`);
    console.log(`Message preview: ${message.substring(0, 150)}...`);

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                sent++;
            } catch (err) {
                console.error(`❌ Failed to send to client:`, err.message);
                failed++;
            }
        } else {
            console.log(`⚠️  Client not ready (state: ${client.readyState})`);
            failed++;
        }
    }

    console.log(`📤 Broadcast complete: ${sent} sent, ${failed} failed (${clients.size} total)`);
    console.log(`===== BROADCAST END =====\n`);
}

/* ================= REDIS (v4 FIXED) ================= */

let redisAvailable = false;
let redisClient = null;
let redisSubscriber = null;

async function startRedis() {
    if (!REDIS_ENABLED) {
        console.log('ℹ Redis disabled');
        return;
    }

    try {
        const Redis = require('redis');

        redisClient = Redis.createClient({
            socket: {
                host: REDIS_HOST,
                port: REDIS_PORT,
                reconnectStrategy: retries =>
                    Math.min(retries * REDIS_RETRY_INTERVAL, 30000)
            }
        });

        redisSubscriber = redisClient.duplicate();

        redisClient.on('error', err => {
            console.error('❌ Redis client error:', err.message);
            redisAvailable = false;
        });

        redisSubscriber.on('error', err => {
            console.error('❌ Redis subscriber error:', err.message);
            redisAvailable = false;
        });

        await redisClient.connect();
        await redisSubscriber.connect();

        redisAvailable = true;
        console.log('✅ Redis connected');

        // 🔥 REDIS v4 CORRECT SUBSCRIBE
        await redisSubscriber.subscribe('tournament_events', (message) => {
            try {
                console.log('\n📥 ===== REDIS MESSAGE RECEIVED =====');
                console.log('Raw:', message);

                const event = JSON.parse(message);

                console.log('Event:', event.event);
                console.log('Payload keys:', Object.keys(event.payload || {}));

                broadcast(event);

                console.log('✅ ===== MESSAGE PROCESSED =====\n');
            } catch (err) {
                console.error('❌ Redis message parse error:', err.message);
                console.error('Raw:', message);
            }
        });

        console.log('✅ Subscribed to tournament_events');
    } catch (err) {
        redisAvailable = false;
        console.warn('⚠ Redis unavailable, using file fallback');
        console.warn(err.message);
    }
}

startRedis();

/* ================= FILE FALLBACK ================= */

if (!fs.existsSync(EVENT_DIR)) {
    fs.mkdirSync(EVENT_DIR, { recursive: true });
}

console.log('📁 Watching event directory:', EVENT_DIR);

const processedFiles = new Set();

setInterval(() => {
    if (redisAvailable) return;

    try {
        const files = fs.readdirSync(EVENT_DIR)
            .filter(f => f.startsWith('tournament_') && f.endsWith('.json'));

        for (const file of files) {
            if (processedFiles.has(file)) continue;

            const filePath = path.join(EVENT_DIR, file);
            processedFiles.add(file);

            try {
                const stats = fs.statSync(filePath);
                if (Date.now() - stats.mtimeMs < 50) {
                    processedFiles.delete(file);
                    continue;
                }

                const raw = fs.readFileSync(filePath, 'utf8');
                const event = JSON.parse(raw);

                console.log('📂 File event:', event.event);
                broadcast(event);

                fs.unlinkSync(filePath);
            } catch (err) {
                console.error('❌ File event error:', err.message);
            }
        }
    } catch (err) {
        console.error('❌ Directory watch error:', err.message);
    }
}, 500);

/* ================= START ================= */

server.listen(PORT, () => {
    console.log('🚀 Tournament WebSocket server running');
    console.log(`🔗 ws://localhost:${PORT}/ws/tournaments`);
});
