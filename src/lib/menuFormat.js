// Вес/объём для строки под названием: «510 г», «750 мл». В данных он бывает
// в specific_details ({weight_value, weight_unit} или строка «750 мл») и в
// weight_g в виде «/ 510 г.».
export function formatWeight(dish) {
    const d = dish.specific_details;
    if (d && typeof d === 'object' && d.weight_value) return `${d.weight_value} ${d.weight_unit || 'г'}`;
    if (typeof d === 'string' && d.trim()) return d.trim();
    if (dish.weight_g) return String(dish.weight_g).replace(/^[\s/]+/, '').replace(/\.$/, '').trim();
    return '';
}

export const formatPrice = (rub) => `${Number(rub || 0).toLocaleString('ru-RU')} ₽`;
