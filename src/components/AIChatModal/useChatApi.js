import { useState } from 'react';
import { supabase } from '../../supabaseClient';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    const sendMessageToAI = async (text, context, sessionId = 'default-user', restaurantId = null, guestId = null) => {
        setIsLoading(true);
        
        // 🔥 Получаем preferences и visit_count гостя из БД
let guestPreferences = null;
if (guestId) {
    try {
        const { data } = await supabase
            .from('guests')
            .select('preferences, visit_count')
            .eq('id', guestId)
            .single();
        
        // Формируем объект с данными гостя
        guestPreferences = {
            ...(data?.preferences || {}),  // Разворачиваем существующие preferences (tags, comments)
            visit_count: data?.visit_count || 0  // Добавляем счетчик визитов
        };
        
        console.log('🔥 Preferences отправляются в AI:', guestPreferences);
    } catch (err) {
        console.warn('Не удалось загрузить preferences:', err);
    }
}
        
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
                    sessionId: sessionId,
                    restaurantId: restaurantId,
                    guestId: guestId,
                    preferences: guestPreferences // 🔥 Отправляем preferences в n8n
                }),
            });
            
            // Если сервер ответил с ошибкой (например, 500 или 404)
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            // Получаем «сырой» ответ от сервера
            const responseText = await response.text();
            
            try {
                // Пытаемся распарсить ответ как JSON
                const data = JSON.parse(responseText);
                return data.output || data.text || data.message || responseText;
            } catch (jsonError) {
                return responseText;
            }

        } catch (error) {
            console.error("n8n Error:", error);
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            setIsLoading(false);
        }
    };

    return { sendMessageToAI, isLoading };
};
