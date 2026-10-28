// Маршрут /voice: отказы до всякого обращения к ИИ (Origin, билет, лимиты).
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { voiceRoutes } from '../src/voiceSession.js';

let app;
let port;

before(async () => {
  config.allowedOrigins = ['https://guest.restai.pro'];
  config.requireTicket = true;
  config.maxNewSessionsPerIpPerMinute = 2;
  config.maxConcurrentSessions = 15;
  app = Fastify({ logger: false, trustProxy: config.trustProxy });
  await app.register(websocket);
  await app.register(voiceRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = app.server.address().port;
});

after(async () => { await app.close(); });

// Открывает /voice и возвращает первое сообщение сервера (и код закрытия).
function ask(query = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/voice?${query}`, { headers });
    let first = null;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('нет ответа')); }, 3000);
    ws.on('message', (raw) => { if (!first) first = JSON.parse(raw.toString()); });
    ws.on('close', (code) => { clearTimeout(timer); resolve({ first, code }); });
    ws.on('error', reject);
  });
}

const OK_ORIGIN = { Origin: 'https://guest.restai.pro' };

test('чужой Origin и пустой Origin — отказ forbidden', async () => {
  const a = await ask('deviceId=d1', { Origin: 'https://evil.example' });
  assert.equal(a.first.code, 'forbidden');
  const b = await ask('deviceId=d1');
  assert.equal(b.first.code, 'forbidden');
});

test('без билета при REQUIRE_TICKET=1 — отказ forbidden, с мусорным билетом — тоже', async () => {
  const a = await ask('deviceId=d2&restaurantId=r&tableNumber=7', { ...OK_ORIGIN, 'x-forwarded-for': '198.51.100.1' });
  assert.equal(a.first.code, 'forbidden');
  assert.match(a.first.message, /подтвердить стол/);
  const b = await ask('deviceId=d3&ticket=not-a-ticket', { ...OK_ORIGIN, 'x-forwarded-for': '198.51.100.2' });
  assert.equal(b.first.code, 'forbidden');
});

test('больше 2 новых подключений в минуту с одного IP — отказ limit (IP берётся из X-Forwarded-For)', async () => {
  const h = { ...OK_ORIGIN, 'x-forwarded-for': '203.0.113.50' };
  assert.equal((await ask('deviceId=a', h)).first.code, 'forbidden'); // дошло до проверки билета
  assert.equal((await ask('deviceId=b', h)).first.code, 'forbidden');
  const third = await ask('deviceId=c', h);
  assert.equal(third.first.code, 'limit');
  // другой IP не затронут
  assert.equal((await ask('deviceId=d', { ...OK_ORIGIN, 'x-forwarded-for': '203.0.113.51' })).first.code, 'forbidden');
});

test('общий потолок линий — busy', async () => {
  config.maxConcurrentSessions = 0;
  try {
    const r = await ask('deviceId=z', { ...OK_ORIGIN, 'x-forwarded-for': '203.0.113.60' });
    assert.equal(r.first.code, 'busy');
  } finally {
    config.maxConcurrentSessions = 15;
  }
});
