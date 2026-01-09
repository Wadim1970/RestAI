import { useState } from 'react'; // Импортируем хук состояния из React

export const useChatApi = (webhookUrl) => {
    // Состояние загрузки (true, пока ждем ответ от сервера)
    const [isLoading, setIsLoading] = useState(false);

    // Основная функция для отправки сообщения нейросети
    const sendMessageToAI = async (text, context, sessionId = 'default-user') => {
        setIsLoading(true); // Включаем индикатор загрузки
        try {
            // Отправляем POST запрос на адрес вебхука n8n
            const response = await fetch(webhookUrl, {
                method: 'POST', // Метод отправки данных
                headers: { 'Content-Type': 'application/json' }, // Указываем, что отправляем JSON
                body: JSON.stringify({
                    message: text,        // Текст сообщения от пользователя
                    context: context,      // Окружение (на какой странице находится юзер)
                    sessionId: sessionId   // ID сессии для сохранения истории в n8n (Redis)
                }),
            });

            // Проверяем, успешно ли прошел запрос (код 200-299)
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            // ПОПРАВКА: Пытаемся получить текст ответа, так как n8n может слать не только JSON
            const responseText = await response.text();
            
            try {
                // Пробуем превратить текст в объект (JSON)
                const data = JSON.parse(responseText);
                // Если это JSON, ищем ответ в полях output, text или message
                return data.output || data.text || data.message || responseText;
            } catch (jsonError) {
                // Если это не JSON (а просто строка от Grok), возвращаем текст как есть
                return responseText;
            }

        } catch (error) {
            // Если что-то пошло не так (сеть, сервер n8n упал, ошибка парсинга)
            console.error("n8n Error:", error);
            // Возвращаем дружелюбную заглушку, чтобы юзер не видел техническую ошибку
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            setIsLoading(false); // Выключаем индикатор загрузки в любом случае
        }
    };

    // Возвращаем функцию и состояние наружу для использования в компонентах
    return { sendMessageToAI, isLoading };
};
