import { useState, useCallback } from 'react'; // Подключаем useState и ОБЯЗАТЕЛЬНО useCallback для стабилизации ссылок

// Хук для связи с твоим сервером n8n
export const useChatApi = (webhookUrl) => {
    // Состояние загрузки: true, когда запрос в пути
    const [isLoading, setIsLoading] = useState(false);

    // МЫ ОБОРАЧИВАЕМ ФУНКЦИЮ В useCallback. Это убивает ошибку #310.
    // Теперь функция не пересоздается при каждом рендере, и useEffect в модалке спокоен.
    const sendMessageToAI = useCallback(async (text, context, sessionId, guestUuid, guestFingerprint) => {
        setIsLoading(true); // Включаем индикатор загрузки ("бот печатает")
        
        try {
            // Выполняем сетевой запрос к твоему вебхуку
            const response = await fetch(webhookUrl, {
                method: 'POST', // Используем метод POST для отправки данных
                mode: 'cors',   // Разрешаем кросс-доменные запросы
                headers: {
                    // Используем text/plain, чтобы избежать лишних проверок (Preflight) в Safari
                    'Content-Type': 'text/plain', 
                    'Accept': 'application/json' // Ожидаем в ответ JSON
                },
                // Превращаем все наши данные в JSON-строку для сервера
                body: JSON.stringify({
                    message: text,               // Текст сообщения или команда ПРИВЕТСТВИЕ
                    context: context,             // Контекст (блюдо или раздел меню)
                    sessionId: sessionId,         // ID текущей сессии чата
                    guestUuid: guestUuid,         // Уникальный ID гостя из localStorage
                    fingerprint: guestFingerprint // Отпечаток устройства
                }),
            });
            
            // Если сервер вернул ошибку (например, 500) — выбрасываем исключение
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            // Получаем ответ от сервера в виде простого текста
            const responseText = await response.text();
            
            try {
                // Пытаемся превратить текст в объект (JSON)
                const data = JSON.parse(responseText);
                // Ищем ответ в разных полях, которые может вернуть n8n
                return data.output || data.text || data.message || responseText;
            } catch (jsonError) {
                // Если сервер прислал не JSON, а просто текст — возвращаем текст как есть
                return responseText;
            }

        } catch (error) {
            // Если произошла любая ошибка (сеть, сервер) — пишем в консоль
            console.error("n8n Error:", error);
            // Возвращаем пользователю вежливую заглушку
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            // Выключаем индикатор загрузки в любом случае (успех или провал)
            setIsLoading(false);
        }
    }, [webhookUrl]); // Функция пересоздастся только если изменится URL вебхука (никогда)

    // Возвращаем стабильную функцию и статус загрузки наружу
    return { sendMessageToAI, isLoading };
};
