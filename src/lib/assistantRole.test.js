// node --test src/lib/assistantRole.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFromDishes, roleFromText, roleFromContext } from './assistantRole.js';

test('по карточкам блюд', () => {
  assert.equal(roleFromDishes([{ product_type: 'food' }]), 'chef');
  assert.equal(roleFromDishes([{ product_type: 'alcohol' }]), 'somm');
  assert.equal(roleFromDishes([{ product_type: 'alcohol' }, { product_type: 'food' }]), 'pair');
  assert.equal(roleFromDishes([{ product_type: 'drink' }]), 'chef');
  assert.equal(roleFromDishes([]), null);
});

test('по тексту ответа', () => {
  assert.equal(roleFromText('К стейку советую бокал красного вина Каберне'), 'pair');
  assert.equal(roleFromText('Попробуйте наше игристое — лёгкое и свежее'), 'somm');
  assert.equal(roleFromText('В этом блюде 320 ккал, много белка и почти нет углеводов'), 'diet');
  assert.equal(roleFromText('Без глютена у нас есть гречка с грибами'), 'diet');
  assert.equal(roleFromText('Сегодня рекомендую шашлык из свинины'), 'chef');
  assert.equal(roleFromText('Здравствуйте! Чем могу помочь?'), null);
  assert.equal(roleFromText('Виноградный сок'), null, '«вино» не находится в «виноград»');
});

test('с чего начать', () => {
  assert.equal(roleFromContext(null), 'chef');
  assert.equal(roleFromContext({ product_type: 'alcohol' }), 'somm');
  assert.equal(roleFromText('Алкогольные напитки'), 'somm', 'раздел меню');
});
