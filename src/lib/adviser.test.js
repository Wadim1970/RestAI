// node --test src/lib/adviser.test.js — кто советует: шеф или сомелье.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviserLabel, adviserRegion, isAlcohol } from './adviser.js';

test('алкоголь — советует сомелье', () => {
  assert.equal(adviserLabel({ product_type: 'alcohol' }), 'Сомелье советует');
  assert.equal(adviserLabel({ product_type: 'alcohol' }, ' к этому'), 'Сомелье советует к этому');
  assert.equal(adviserRegion({ product_type: 'alcohol' }), 'Совет сомелье');
});

test('еда и безалкогольные напитки — советует шеф', () => {
  assert.equal(adviserLabel({ product_type: 'food' }), 'Шеф советует');
  assert.equal(adviserLabel({ product_type: 'drink' }), 'Шеф советует'); // вода, лимонады, безалкогольное вино
  assert.equal(adviserLabel({ product_type: 'food' }, ' к этому'), 'Шеф советует к этому');
  assert.equal(adviserRegion({ product_type: 'food' }), 'Совет шефа');
});

test('блюда нет или тип неизвестен — шеф', () => {
  assert.equal(adviserLabel(null), 'Шеф советует');
  assert.equal(adviserLabel(undefined), 'Шеф советует');
  assert.equal(adviserLabel({}), 'Шеф советует');
  assert.equal(isAlcohol({ product_type: 'Alcohol' }), false); // тип в базе строго alcohol
});
