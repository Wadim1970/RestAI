// Готовое приветствие: имя, ресторан, погода (только при аномальной).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGreeting } from '../src/context.js';

test('приветствие в комфортную погоду заканчивается вопросом', () => {
  assert.equal(
    buildGreeting({ assistantName: 'Marco', restaurantName: 'Сыроварня', temperature: 20 }),
    'Привет! Я Marco, ваш персональный ассистент по ресторану Сыроварня, готов рассказать о меню и принять заказ. С чего начнём?',
  );
});

test('в холод — фраза про погоду с заглавной буквы вместо «С чего начнём?»', () => {
  const text = buildGreeting({ assistantName: 'Marco', restaurantName: 'Сыроварня', temperature: 5 });
  assert.match(text, /принять заказ\. Сегодня довольно холодно, может сразу предложить вам что-то горячее, чтобы согреться\?$/);
});

test('без имени и названия — без пустых мест', () => {
  assert.equal(
    buildGreeting({ assistantName: '', restaurantName: '', temperature: null }),
    'Привет! Я ваш персональный ассистент, готов рассказать о меню и принять заказ. С чего начнём?',
  );
});
