// node --test src/lib/pairingRules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPairing, rememberShown, rememberAnswer, emptyMemory, COOLDOWN_MS } from './pairingRules.js';

const menuById = new Map(['pizza', 'burrata', 'nuts', 'lemonade'].map((id) => [id, { id }]));
const generic = {
  pizza: [{ dishId: 'burrata', lead: 'К пицце — буррата', why: 'Свежо' }, { dishId: 'lemonade', lead: 'К пицце — лимонад', why: 'Освежит' }],
};
const base = { dishId: 'pizza', prevCount: 0, cart: { pizza: 1 }, menuById, generic, personal: null, memory: emptyMemory(), now: 1e6 };

test('первое добавление — общая пара', () => {
  assert.equal(pickPairing(base).dishId, 'burrata');
});

test('не на «ещё одну» и не то, что уже в заказе', () => {
  assert.equal(pickPairing({ ...base, prevCount: 1 }), null);
  assert.equal(pickPairing({ ...base, cart: { pizza: 1, burrata: 1 } }).dishId, 'lemonade');
});

test('личные пары главнее общих, пустой список — без подсказки', () => {
  assert.equal(pickPairing({ ...base, personal: { pizza: [{ dishId: 'lemonade', lead: 'x', why: 'y', personal: true }] } }).personal, true);
  assert.equal(pickPairing({ ...base, personal: { pizza: [] } }), null);
});

test('лимиты: раз в минуту, 3 за визит, два отказа подряд', () => {
  let m = rememberShown(emptyMemory(), base.now);
  assert.equal(pickPairing({ ...base, memory: m, now: base.now + 1000 }), null);
  assert.ok(pickPairing({ ...base, memory: m, now: base.now + COOLDOWN_MS + 1 }));

  assert.equal(pickPairing({ ...base, memory: { ...emptyMemory(), shown: 3 } }), null);

  const offer = pickPairing(base);
  m = rememberAnswer(emptyMemory(), offer, false);
  assert.equal(pickPairing({ ...base, memory: m }).dishId, 'lemonade', 'отклонённая пара больше не предлагается');
  m = rememberAnswer(m, { anchorId: 'pizza', dishId: 'lemonade' }, false);
  assert.equal(pickPairing({ ...base, dishId: 'pizza', memory: m }), null, 'два отказа подряд — стоп');
  assert.equal(rememberAnswer(m, offer, true).declineStreak, 0);
});
