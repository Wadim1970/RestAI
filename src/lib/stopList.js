// Стоп-лист кухни (раздел «Кухня» админки): блюда «нет в наличии».
// Меню приходит с /api/menu с пометкой stopped; MenuPage кладёт их сюда,
// а корзина (App.updateCart) не даёт добавить такое блюдо ни из меню, ни
// голосом, ни из чата.
let stopped = new Set()

export function setStoppedDishes(items) {
  stopped = new Set((items || []).filter((i) => i.stopped).map((i) => i.id))
}

export function isStopped(dishId) {
  return stopped.has(dishId)
}
