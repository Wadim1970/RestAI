// node --test src/lib/tableCart.test.js — сверка корзины гостя с сервером.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartTotals, toConfirmedItems, dishCardsFromLines, planPush, adoptServerCart, sameCart } from './tableCart.js'

const line = (id, item_id, quantity, status = 'new', extra = {}) => ({
  id, item_id, quantity, status, dish_name: `Блюдо ${item_id}`, unit_price: 100, comment: null, modifiers: [], ...extra,
})

test('корзина — только строки new, одинаковые блюда суммируются', () => {
  const lines = [line('l1', 'a', 2), line('l2', 'a', 1, 'new', { comment: 'без соли' }), line('l3', 'b', 1, 'sent')]
  assert.deepEqual(cartTotals(lines), { a: 3 })
})

test('«Уже готовится» — отправленное и готовое, не корзина', () => {
  const lines = [line('l1', 'a', 2), line('l2', 'b', 1, 'sent'), line('l3', 'c', 2, 'ready', { modifiers: [{ id: 'm', name: 'Medium', price_delta: 100 }] })]
  const out = toConfirmedItems(lines)
  assert.deepEqual(out.map((x) => [x.id, x.count, x.status]), [['b', 1, 'sent'], ['c', 2, 'ready']])
  assert.equal(out[1].modifiers[0].name, 'Medium')
})

test('карточки блюд из корзины не затирают уже известные', () => {
  const cards = dishCardsFromLines([line('l1', 'a', 1), line('l2', 'b', 1)], { a: { id: 'a' } })
  assert.deepEqual(Object.keys(cards), ['b'])
})

test('гость увеличил блюдо — уходит cart_set с новым количеством', () => {
  const ops = planPush({ a: 3 }, new Set(['a']), [line('l1', 'a', 2)])
  assert.deepEqual(ops, [{ itemId: 'a', quantity: 3, comment: null, modifiers: [] }])
})

test('новое блюдо — cart_set с количеством', () => {
  const ops = planPush({ a: 1 }, new Set(['a']), [])
  assert.deepEqual(ops, [{ itemId: 'a', quantity: 1, comment: null, modifiers: [] }])
})

test('гость убрал блюдо — cart_set с нулём', () => {
  const ops = planPush({}, new Set(['a']), [line('l1', 'a', 2)])
  assert.deepEqual(ops, [{ itemId: 'a', quantity: 0, comment: null, modifiers: [] }])
})

test('сервер уже совпадает — ничего не шлём (повтор безопасен)', () => {
  assert.deepEqual(planPush({ a: 2 }, new Set(['a']), [line('l1', 'a', 2)]), [])
})

test('блюдо с комментарием и опциями от голосового помощника идёт в свою строку', () => {
  const dishes = { s: { comment: 'без соли', modifiers: [{ id: 'm1' }] } }
  const lines = [line('l1', 's', 1, 'new', { comment: 'без соли', modifiers: [{ id: 'm1', name: 'Medium' }] })]
  const ops = planPush({ s: 2 }, new Set(['s']), lines, dishes)
  assert.deepEqual(ops, [{ itemId: 's', quantity: 2, comment: 'без соли', modifiers: ['m1'] }])
})

test('официант добавил то же блюдо с другими опциями: гость увеличивает свою строку, чужая не трогается', () => {
  const dishes = { s: { modifiers: [] } }
  const lines = [line('w', 's', 1, 'new', { comment: 'medium' }), line('g', 's', 1)]
  // у гостя в корзине 3 порции (1 официанта + 1 своя + 1 новая)
  const ops = planPush({ s: 3 }, new Set(['s']), lines, dishes)
  assert.deepEqual(ops, [{ itemId: 's', quantity: 2, comment: null, modifiers: [] }])
})

test('гость уменьшает: сначала своя строка, затем остальные', () => {
  const lines = [line('w', 's', 2, 'new', { comment: 'medium' }), line('g', 's', 1)]
  const ops = planPush({ s: 1 }, new Set(['s']), lines, {})
  assert.deepEqual(ops, [
    { itemId: 's', quantity: 0, comment: null, modifiers: [] },
    { itemId: 's', quantity: 1, comment: 'medium', modifiers: [] },
  ])
})

test('не dirty блюда не пушатся', () => {
  assert.deepEqual(planPush({ a: 5 }, new Set(), [line('l1', 'a', 1)]), [])
})

test('правка официанта подтягивается, изменённое гостем остаётся', () => {
  const lines = [line('l1', 'a', 3), line('l2', 'b', 1), line('l3', 'd', 2)]
  const next = adoptServerCart({ a: 1, b: 9, c: 4 }, new Set(['b']), lines)
  // a — не менялось гостем → 3 с сервера; b — менял → 9; c — нет на сервере и не менял → пропало; d — добавил официант
  assert.deepEqual(next, { a: 3, b: 9, d: 2 })
})

test('официант убрал блюдо — у гостя оно пропадает', () => {
  assert.deepEqual(adoptServerCart({ a: 1 }, new Set(), []), {})
})

test('sameCart', () => {
  assert.ok(sameCart({ a: 1, b: 2 }, { b: 2, a: 1 }))
  assert.ok(!sameCart({ a: 1 }, { a: 2 }))
  assert.ok(!sameCart({ a: 1 }, { a: 1, b: 1 }))
})

test('картинка блюда: живое фото; ссылка миниатюры на несуществующий облачный Supabase не используется', () => {
  const DEAD = 'https://utdfzrpkoscyikitceow.supabase.co/storage/v1/object/public/menu-images/thumbnails/x.webp'
  const PHOTO = 'https://api.syrovarnya.com/photo.jpg'
  const lines = [
    line('l1', 'a', 1, 'sent', { image_url: PHOTO, image_url_thumbnail: DEAD }),
    line('l2', 'b', 1, 'new', { image_url: PHOTO, image_url_thumbnail: DEAD }),
  ]
  assert.equal(toConfirmedItems(lines)[0].image_url, PHOTO)
  assert.equal(dishCardsFromLines(lines).b.image_url, PHOTO)
})
