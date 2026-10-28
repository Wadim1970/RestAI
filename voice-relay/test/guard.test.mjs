// node --test test/guard.test.mjs — защита /voice: лимиты, Origin, билет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionGuard, originAllowed } from '../src/guard.js';
import { consumeTicket } from '../src/ticket.js';

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, tick: (ms) => { t += ms; } };
};
const IP = '203.0.113.7';

test('Origin: список не задан — пускаем всех; задан — только свои, пустой нельзя', () => {
  assert.equal(originAllowed(undefined, []), true);
  assert.equal(originAllowed('https://evil.example', ['https://guest.restai.pro']), false);
  assert.equal(originAllowed(undefined, ['https://guest.restai.pro']), false);
  assert.equal(originAllowed('https://guest.restai.pro', ['https://guest.restai.pro']), true);
  assert.equal(originAllowed('https://GUEST.restai.pro/', ['https://guest.restai.pro']), true);
});

test('не больше 3 одновременных разговоров с одного IP', () => {
  const g = new SessionGuard({ perIpMax: 3 });
  const a = [1, 2, 3].map((i) => g.open({ ip: IP, deviceId: `d${i}` }));
  assert.ok(a.every((r) => r.ok));
  const fourth = g.open({ ip: IP, deviceId: 'd4' });
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'limit');
  a[0].release();
  assert.equal(g.open({ ip: IP, deviceId: 'd5' }).ok, true);
});

test('другой IP не затронут', () => {
  const g = new SessionGuard({ perIpMax: 1 });
  assert.ok(g.open({ ip: IP, deviceId: 'a' }).ok);
  assert.ok(g.open({ ip: '198.51.100.9', deviceId: 'b' }).ok);
});

test('не больше N новых подключений в минуту, потом снова можно', () => {
  const c = clock();
  const g = new SessionGuard({ perIpMax: 100, perIpPerMinute: 3, now: c.now });
  for (let i = 0; i < 3; i++) g.open({ ip: IP, deviceId: `d${i}` }).release();
  assert.equal(g.open({ ip: IP, deviceId: 'x' }).ok, false);
  c.tick(61_000);
  assert.equal(g.open({ ip: IP, deviceId: 'y' }).ok, true);
});

test('дневной потолок минут с IP', () => {
  const c = clock();
  const g = new SessionGuard({ perIpMax: 3, perIpPerMinute: 100, perIpMinutesPerDay: 10, now: c.now });
  const s = g.open({ ip: IP, deviceId: 'a' });
  c.tick(11 * 60_000);
  s.release();
  const next = g.open({ ip: IP, deviceId: 'b' });
  assert.equal(next.ok, false);
  assert.match(next.message, /Дневной лимит/);
  c.tick(24 * 3600_000);
  assert.equal(g.open({ ip: IP, deviceId: 'c' }).ok, true);
});

test('новое подключение с того же устройства вытесняет прежнее', () => {
  const g = new SessionGuard({ perIpMax: 3 });
  let closed = 0;
  g.open({ ip: IP, deviceId: 'phone', close: () => { closed += 1; } });
  const second = g.open({ ip: IP, deviceId: 'phone' });
  assert.equal(second.ok, true);
  assert.equal(closed, 1);
});

test('release вызывается повторно безопасно и не уходит в минус', () => {
  const g = new SessionGuard({ perIpMax: 1 });
  const s = g.open({ ip: IP, deviceId: 'a' });
  s.release(); s.release(); s.release();
  assert.equal(g.open({ ip: IP, deviceId: 'b' }).ok, true);
  assert.equal(g.open({ ip: IP, deviceId: 'c' }).ok, false);
});

test('все подключения с 127.0.0.1 (IP не виден): лимиты по IP не включаются и не блокируют всех', () => {
  const warns = [];
  const g = new SessionGuard({ perIpMax: 1, onWarn: (m) => warns.push(m) });
  for (let i = 0; i < 10; i++) assert.ok(g.open({ ip: '127.0.0.1', deviceId: `d${i}` }).ok);
  assert.equal(warns.length, 1);
});

test('билет: верный формат и ответ базы → данные разговора', async () => {
  const good = 'a'.repeat(64);
  const rpc = async (name, args) => {
    assert.equal(name, 'voice_ticket_consume');
    assert.equal(args.p_ticket, good);
    return { data: { restaurant_id: 'R', table_number: '7', device_id: 'dev' }, error: null };
  };
  assert.deepEqual(await consumeTicket(good, rpc), { restaurantId: 'R', tableNumber: '7', deviceId: 'dev' });
});

test('билет: мусор в базу даже не отправляется; null/ошибка/исключение → null', async () => {
  let calls = 0;
  const rpc = async () => { calls += 1; return { data: null, error: null }; };
  assert.equal(await consumeTicket('short', rpc), null);
  assert.equal(await consumeTicket(undefined, rpc), null);
  assert.equal(await consumeTicket('A'.repeat(64), rpc), null); // заглавные — не наш формат
  assert.equal(calls, 0);
  assert.equal(await consumeTicket('b'.repeat(64), rpc), null);
  assert.equal(await consumeTicket('b'.repeat(64), async () => ({ data: null, error: { message: 'x' } })), null);
  assert.equal(await consumeTicket('b'.repeat(64), async () => { throw new Error('сеть'); }), null);
});
