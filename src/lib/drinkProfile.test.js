import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drinkProfile, drinkNotes } from './drinkProfile.js';

test('вино: крепость отдельно, аромат отдельно, характеристики по порядку', () => {
  const p = drinkProfile({
    'Год производства': 2021, 'Крепость': 12.5, 'Аромат': 'Цитрус и белые цветы', 'Сорт винограда': 'Sauvignon Blanc',
    'Кислотность': 'Высокая', 'Регион': 'Мальборо', 'Полнота': 'Легкое',
  });
  assert.equal(p.strength, '12.5%');
  assert.equal(p.aroma, 'Цитрус и белые цветы');
  assert.deepEqual(p.rows.map(([k]) => k), ['Полнота', 'Кислотность', 'Сорт винограда', 'Год производства', 'Регион']);
  assert.equal(p.grape, 'Sauvignon Blanc');
  assert.equal(p.vintage, '2021');
});

test('КБЖУ и пустые значения — не характеристики; строка для ИИ', () => {
  assert.deepEqual(drinkProfile({ calories: 125, fat: 0, 'Полнота': '' }).rows, []);
  assert.deepEqual(drinkProfile(null).rows, []);
  assert.equal(drinkNotes({ 'Крепость': 14.5, 'Танины': 'Средние', 'Аромат': 'смородина' }), 'крепость 14.5%; танины: Средние; аромат: смородина');
});
