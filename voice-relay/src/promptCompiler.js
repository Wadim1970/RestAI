// Превращает структурированный профиль ресторана (JSONB из
// restaurant_ai_profiles) в текст для системного промта.
//
// Два разных подхода намеренно: "дельки" характера (0-10) и манера речи
// отдаются модели как размеченные данные + одна инструкция "строй
// характер по этим параметрам" — вручную расписывать словами все
// сочетания цифр было бы комбинаторным взрывом формулировок, а
// современные голосовые модели сами неплохо интерпретируют такие шкалы.
// Бизнес-правила (пороги среднего чека, ограничения) — наоборот,
// компилируются в явные условные предложения: тут нужна точность
// исполнения правила, а не "настроение".

const TRAIT_LABELS = {
  friendliness: 'дружелюбие',
  energy: 'энергичность',
  emotionality: 'эмоциональность',
  sociability: 'общительность',
  humor: 'чувство юмора',
  charisma: 'харизматичность',
  patience: 'терпеливость',
  caring: 'заботливость',
  formality: 'формальность',
  eloquence: 'интеллигентность речи',
};

function traitList(traits) {
  const entries = Object.entries(traits || {}).filter(([, v]) => v != null);
  if (!entries.length) return '';
  return entries.map(([key, value]) => `${TRAIT_LABELS[key] || key}: ${value}/10`).join(', ');
}

function styleLines(style) {
  if (!style) return [];
  const lines = [];
  if (style.speech_style) lines.push(`Стиль речи: ${style.speech_style}.`);
  if (style.response_length) lines.push(`Длина ответов: ${style.response_length}.`);
  if (style.pace) lines.push(`Темп речи: ${style.pace}.`);
  if (style.uses_emotions) lines.push(`Эмоции в речи: ${style.uses_emotions}.`);
  if (style.uses_compliments) lines.push(`Комплименты гостю: ${style.uses_compliments}.`);
  if (style.uses_guest_name != null) {
    lines.push(style.uses_guest_name ? 'Обращайся к гостю по имени, если оно известно.' : 'Не используй имя гостя в обращении.');
  }
  if (style.address_form) lines.push(`Форма обращения: ${style.address_form}.`);
  if (style.loves_storytelling) lines.push('Ты любишь к месту рассказать короткую историю.');
  return lines;
}

function culturalFlavorLine(cf) {
  if (!cf?.style) return '';
  let line = `Культурный образ: ${cf.style}.`;
  if (cf.uses_national_words && cf.examples?.length) {
    const freq = cf.frequency === 'часто' ? 'Часто' : 'Изредка, к месту';
    line += ` ${freq} используешь характерные слова/восклицания, например: ${cf.examples.join(', ')}. Это атмосфера, а не карикатура — не переигрывай.`;
  }
  return line;
}

function humorLine(h) {
  if (!h) return '';
  const parts = [`Уровень юмора: ${h.level ?? 0}/10${h.type ? `, тип — ${h.type}` : ''}.`];
  if (h.can_initiate) parts.push('Можешь шутить первым, когда уместно.');
  if (h.can_respond) parts.push('Можешь ответить шуткой на шутку гостя.');
  return parts.join(' ');
}

export function compileCharacterProfile(cp) {
  if (!cp || Object.keys(cp).length === 0) return '';
  const lines = [];

  const identity = [`Тебя зовут ${cp.name || 'ассистент'}`];
  if (cp.role) identity.push(`, ты — ${cp.role} этого ресторана`);
  if (cp.age) identity.push(`, тебе ${cp.age} лет`);
  lines.push(identity.join('') + '.');

  if (cp.backstory) lines.push(cp.backstory);

  const cultural = culturalFlavorLine(cp.cultural_flavor);
  if (cultural) lines.push(cultural);

  const traits = traitList(cp.traits);
  if (traits) lines.push(`Черты характера (ориентируйся на них при построении речи и поведения, это шкалы 0-10): ${traits}.`);

  lines.push(...styleLines(cp.style));

  const humor = humorLine(cp.humor);
  if (humor) lines.push(humor);

  if (cp.catchphrases?.length) {
    lines.push(`Твои фирменные фразы, вставляй их к месту, не в каждой реплике: ${cp.catchphrases.map((p) => `«${p}»`).join(', ')}.`);
  }

  if (cp.voice?.accent_instruction) lines.push(cp.voice.accent_instruction);

  return lines.filter(Boolean).join('\n');
}

function avgCheckTierLines(tiers) {
  if (!tiers?.length) return [];
  return tiers
    .map((t) => {
      if (t.max_avg_check != null && t.max_recommend_price != null) {
        return `Если средний чек гостя ниже ${t.max_avg_check}₽ — не рекомендуй блюда дороже ${t.max_recommend_price}₽.`;
      }
      if (t.min_avg_check != null && t.allow_premium) {
        return `Если средний чек гостя от ${t.min_avg_check}₽ — можно смело рекомендовать премиальные позиции.`;
      }
      return null;
    })
    .filter(Boolean);
}

export function compileRestaurantPolicy(rp) {
  if (!rp || Object.keys(rp).length === 0) return '';
  const lines = [];

  if (rp.primary_goal) lines.push(`Главная цель твоей работы: ${rp.primary_goal}.`);

  const s = rp.sales;
  if (s) {
    const offers = ['upsell', 'desserts', 'coffee', 'alcohol', 'appetizers']
      .filter((key) => s[key])
      .map((key) => ({ upsell: 'апселл', desserts: 'десерты', coffee: 'кофе', alcohol: 'алкоголь', appetizers: 'закуски' })[key]);
    lines.push(`Активность продаж: ${s.activity ?? 0}/10.${offers.length ? ` Предлагай к месту: ${offers.join(', ')}.` : ''}`);
  }

  if (rp.recommendation_priority?.length) {
    lines.push(`Приоритет рекомендаций (от важного к менее важному): ${rp.recommendation_priority.join(' → ')}.`);
  }

  const rec = rp.recommendation_policy;
  if (rec) {
    const parts = [];
    if (rec.max_options) parts.push(`не больше ${rec.max_options} вариантов за раз`);
    if (rec.explain_choice) parts.push('объясняй, почему рекомендуешь именно это');
    if (rec.ask_clarifying_questions) parts.push('уточняй предпочтения гостя перед советом');
    if (rec.can_recommend_expensive === false) parts.push('избегай дорогих позиций без явного запроса гостя');
    if (parts.length) lines.push(`Политика рекомендаций: ${parts.join(', ')}.`);
  }

  lines.push(...avgCheckTierLines(rp.avg_check_tiers));

  if (rp.vip_policy?.extra_attention) {
    lines.push('Если гость отмечен как VIP — уделяй больше внимания, чаще предлагай вино и персональные советы.');
  }

  if (rp.kids_policy?.offer_kids_menu) {
    lines.push('Если за столом дети — предлагай детское меню, не упоминай алкоголь.');
  }

  if (rp.time_policy?.avoid_long_dishes_when_closing_soon) {
    const mins = rp.time_policy.kitchen_closing_soon_minutes ?? 20;
    lines.push(`Если до закрытия кухни осталось меньше ${mins} минут — не рекомендуй долго готовящиеся блюда.`);
  }

  if (rp.kitchen_load_policy?.prefer_fast_when_overloaded) {
    lines.push('Если кухня перегружена — реже рекомендуй сложные блюда, чаще — быстрые в приготовлении.');
  }

  if (rp.hard_restrictions?.length) {
    lines.push(`Никогда: ${rp.hard_restrictions.join('; ')}.`);
  }

  return lines.filter(Boolean).join('\n');
}
