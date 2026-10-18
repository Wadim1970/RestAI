// Кто сейчас отвечает гостю — для цвета «дыма в бокале» на голосовом экране:
//   chef — еда (по умолчанию), somm — напитки и вино, diet — калории,
//   аллергии, «лёгкое»; pair — шеф и сомелье вместе (блюдо + вино).
// Чистые функции, проверяются node --test.

// Карточки блюд, которые ассистент показывает (show_dish): у каждого
// product_type — food | drink | alcohol. Это самый надёжный сигнал.
export function roleFromDishes(dishes) {
  if (!Array.isArray(dishes) || !dishes.length) return null;
  const alco = dishes.some((d) => d?.product_type === 'alcohol');
  const food = dishes.some((d) => !d?.product_type || d.product_type === 'food');
  if (alco && food) return 'pair';
  if (alco) return 'somm';
  return 'chef';
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

// Корни слов — с начала слова, чтобы «вино» не находилось в «виноград» и т.п.
const SOMM_RE = /(^|[^а-яa-z])(вин[оаеуы](?![а-яa-z])|винн|алкогол|бокал|игрист|шампанск|просекко|сомелье|коньяк|виски|джин|ром\b|текил|ликер|вермут|коктейл|пив[оа]|сидр|аперитив|дижестив|танин|букет|выдержк|сорт[а ]+виноград|красн[оы][ейм] сух|бел[оы][ейм] сух)/;
const DIET_RE = /(^|[^а-яa-z])(калори|ккал|белк|жир[аыов ]|углевод|кбжу|аллерг|глютен|лактоз|веган|вегетариан|постн|диет|полезн|легк[оие][ей ]?|низкокалор|без сахар|сахар[аео ]|орех|пищев[ао]я ценност)/;
const FOOD_RE = /(^|[^а-яa-z])(блюд|стейк|паст[аеуы]|пицц|салат|суп|борщ|десерт|рыб|мяс|сыр|закуск|горяч|гарнир|шашлык|котлет|соус|хлеб|фокачч)/;

// Роль по тексту ответа (можно по началу — первым 80–120 символам).
// null — по тексту не понять, оставляем текущую.
export function roleFromText(text) {
  const t = norm(text);
  if (!t.trim()) return null;
  const somm = SOMM_RE.test(t);
  const diet = DIET_RE.test(t);
  const food = FOOD_RE.test(t);
  if (diet && !somm) return 'diet';
  if (somm && food) return 'pair';
  if (somm) return 'somm';
  if (food) return 'chef';
  return null;
}

// С чего начать: откуда открыли голосового ассистента (карточка блюда).
export function roleFromContext(dish) {
  if (!dish) return 'chef';
  return roleFromDishes([dish]) || 'chef';
}

// Цвет роли для интерфейса (визуализатор и т.п.) — те же, что у дыма.
export const ROLE_COLORS = { chef: '#EB651A', somm: '#B0123C', diet: '#4DD17A', pair: '#DA4334' };
