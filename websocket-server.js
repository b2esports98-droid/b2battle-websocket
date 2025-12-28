/**
 * Tournament WebSocket Server
 * Railway + Upstash Redis (Production Ready)
 *
 * Required ENV:
 *   PORT        -> provided automatically by Railway
 *   REDIS_URL   -> Upstash Redis URL (rediss://...)
 */

require('dotenv').config();

const WebSocket = require('ws');
const http = require('http');
const { createClient } = require('redis');

/* ================= CONFIG ================= */

const PORT = process.env.PORT; // REQUIRED by Railway
const REDIS_URL = process.env.REDIS_URL;

if (!PORT) {
  console.error('❌ PORT not defined');
  process.exit(1);
}

if (!REDIS_URL) {
  console.error('❌ REDIS_URL not defined');
  process.exit(1);
}

/* ================= WEBSOCKET ================= */

const server = http.createServer();

const wss = new WebSocket.Server({
  server,
  path: '/ws/tournaments'
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

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/* ================= REDIS (UPSTASH) ================= */

(async () => {
  try {
    const redisClient = createClient({
      url: REDIS_URL
    });

    const redisSubscriber = redisClient.duplicate();

    redisClient.on('error', err => {
      console.error('❌ Redis client error:', err.message);
    });

    redisSubscriber.on('error', err => {
      console.error('❌ Redis subscriber error:', err.message);
    });

    await redisClient.connect();
    await redisSubscriber.connect();

    console.log('✅ Redis connected');

    await redisSubscriber.subscribe('tournament_events', message => {
      try {
        const event = JSON.parse(message);
        console.log(`📥 Redis event: ${event.event}`);
        broadcast(event);
      } catch (err) {
        console.error('❌ Invalid Redis message:', err.message);
      }
    });

    console.log('✅ Subscribed to tournament_events');
  } catch (err) {
    console.error('❌ Redis connection failed:', err.message);
    process.exit(1);
  }
})();

/* ================= START SERVER ================= */

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Tournament WebSocket server running');
  console.log(`🔗 Listening on port ${PORT}`);
});
