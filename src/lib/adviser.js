// Кто даёт совет в подсказках гостю: про алкоголь (вино, виски, пиво, коктейли
// и т. д.) советует сомелье, про всё остальное — шеф.
export const isAlcohol = (dish) => dish?.product_type === 'alcohol';

// Подпись над советом: «Шеф советует» / «Сомелье советует» (+ продолжение).
export const adviserLabel = (dish, suffix = '') => `${isAlcohol(dish) ? 'Сомелье' : 'Шеф'} советует${suffix}`;

// Для скринридеров.
export const adviserRegion = (dish) => (isAlcohol(dish) ? 'Совет сомелье' : 'Совет шефа');
