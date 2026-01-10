import { useState } from 'react'; // Подключаем хук для управления состоянием загрузки

export const useChatApi = (webhookUrl) => {
    // isLoading будет true, когда мы отправили запрос и ждем ответа
    const [isLoading, setIsLoading] = useState(false);

    // Основная функция для связи с n8n
    // Принимает: text (сообщение), context (блюдо), sessionId (ID юзера)
    const sendMessageToAI = async (text, context, sessionId = 'default-user') => {
        setIsLoading(true); // Включаем индикатор «бот думает»
        
        try {
            // Выполняем запрос к n8n
            const response = await fetch(webhookUrl, {
                method: 'POST',
    // Убираем mode: 'cors', если n8n и так видит запрос (иногда Safari на нем спотыкается)
    headers: {
        // Пробуем вернуть application/json, но БЕЗ лишних заголовков типа Accept
        'Content-Type': 'application/json' 
    },
    body: JSON.stringify({
        message: text,
        context: context,
        userId: sessionId
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
                // Ищем ответ в разных полях, которые может прислать n8n/AI Agent
                return data.output || data.text || data.message || responseText;
            } catch (jsonError) {
                // Если пришел не JSON, а просто текст — возвращаем как есть
                return responseText;
            }

        } catch (error) {
            // Логируем ошибку в консоль для отладки
            console.error("n8n Error:", error);
            // Возвращаем текст-заглушку для пользователя
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            // В любом случае (успех или ошибка) выключаем загрузку
            setIsLoading(false);
        }
    };

    // Возвращаем функцию и статус загрузки в компонент AIChatModal
    return { sendMessageToAI, isLoading };
};
