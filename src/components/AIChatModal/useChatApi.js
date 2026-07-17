import { useState } from 'react';
import { supabase } from '../../supabaseClient';

// dish_id (сырой UUID) и last_computed_at — не несут смысла для модели,
// только тратят токены на каждом сообщении чата. Оставляем их в самой
// БД (пригодятся для других фич, например кнопки "заказать снова"), но
// не тащим в payload к n8n.
function stripForAI(topDishes) {
    return (topDishes || []).map(({ name, times }) => ({ name, times }));
}

// Служебный маркер авто-приветствия (AIChatModal шлёт его вместо реальной
// реплики гостя) — его самого в историю писать не нужно, а вот ответ-
// приветствие ИИ пишем, чтобы голосовой режим знал, что уже здоровались.
const GREETING_MARKER = 'ПРИВЕТСТВИЕ';

// Единая история диалога (conversation_turns) — общая с голосовым
// режимом. Читаем её ОДИН раз на сообщение (не громоздко: одна лёгкая
// выборка по индексу session_id), форматируем для промпта DeepSeek.
async function loadHistoryText(sessionId) {
    if (!sessionId) return '';
    const { data, error } = await supabase
        .from('conversation_turns')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(40);
    if (error || !data || data.length === 0) return '';
    return data
        .reverse()
        .map((t) => `${t.role === 'user' ? 'Гость' : 'Ассистент'}: ${t.content}`)
        .join('\n');
}

async function saveTurn(sessionId, restaurantId, guestId, role, content) {
    if (!sessionId || !content) return;
    try {
        await supabase.from('conversation_turns').insert({
            session_id: sessionId,
            restaurant_id: restaurantId || null,
            guest_id: guestId != null ? String(guestId) : null,
            role,
            content,
            source: 'text',
        });
    } catch (err) {
        console.warn('Не удалось записать реплику в историю:', err);
    }
}

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    const sendMessageToAI = async (text, context, sessionId = 'default-user', restaurantId = null, guestId = null) => {
        setIsLoading(true);

        // 🔥 Получаем preferences и visit_count гостя из БД — общий, кросс-
        // ресторанный портрет (широкая персонализация), плюс отдельно
        // статистику именно по этому ресторану (guest_restaurant_stats) —
        // чтобы ИИ мог сказать "вы в прошлый раз пробовали наш стейк", а не
        // только опираться на посещения других заведений.
        let guestPreferences = null;
        let restaurantHistory = null;
        if (guestId) {
            try {
                const { data } = await supabase
                    .from('guests')
                    .select('preferences, visit_count, avg_check')
                    .eq('id', guestId)
                    .single();

                const prefs = data?.preferences || {};
                guestPreferences = {
                    tags: prefs.tags,
                    sections: prefs.sections,
                    top_dishes: stripForAI(prefs.top_dishes),
                    total_orders: prefs.total_orders,
                    comments: prefs.comments,
                    visit_count: data?.visit_count || 0,
                    avg_check: data?.avg_check || 0,
                };
            } catch (err) {
                console.warn('Не удалось загрузить preferences:', err);
            }

            if (restaurantId) {
                try {
                    const { data } = await supabase
                        .from('guest_restaurant_stats')
                        .select('tags, top_dishes, avg_check, total_orders')
                        .eq('guest_id', guestId)
                        .eq('restaurant_id', restaurantId)
                        .maybeSingle();

                    if (data) {
                        restaurantHistory = { ...data, top_dishes: stripForAI(data.top_dishes) };
                    }
                } catch (err) {
                    console.warn('Не удалось загрузить статистику по ресторану:', err);
                }
            }
        }

        // История общего диалога (голос + текст) до текущей реплики —
        // передаём её в n8n, чтобы DeepSeek помнил контекст беседы (в т.ч.
        // то, что гость обсуждал голосом). Читаем ДО записи текущей реплики,
        // чтобы она не задвоилась (message уходит отдельным полем).
        const history = await loadHistoryText(sessionId);

        try {
            // Выполняем запрос к n8n
            const response = await fetch(webhookUrl, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'text/plain',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    context: context,
                    history: history, // 🔥 Общая история диалога сессии (голос+текст)
                    sessionId: sessionId,
                    restaurantId: restaurantId,
                    guestId: guestId,
                    preferences: guestPreferences, // 🔥 Общий портрет гостя (все рестораны)
                    restaurantHistory: restaurantHistory, // Что гость заказывал именно здесь
                }),
            });

            // Если сервер ответил с ошибкой (например, 500 или 404)
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            // Получаем «сырой» ответ от сервера
            const responseText = await response.text();

            let answer;
            try {
                const data = JSON.parse(responseText);
                answer = data.output || data.text || data.message || responseText;
            } catch (jsonError) {
                answer = responseText;
            }

            // Пишем в общую историю: реплику гостя (кроме служебного маркера
            // авто-приветствия) и ответ ассистента — чтобы голосовой режим
            // видел текстовую часть разговора.
            if (text !== GREETING_MARKER) {
                await saveTurn(sessionId, restaurantId, guestId, 'user', text);
            }
            await saveTurn(sessionId, restaurantId, guestId, 'assistant', answer);

            return answer;

        } catch (error) {
            console.error("n8n Error:", error);
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            setIsLoading(false);
        }
    };

    return { sendMessageToAI, isLoading };
};
