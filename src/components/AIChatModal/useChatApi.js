import { useState, useCallback } from 'react';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    // useCallback делает функцию стабильной. Теперь она не вызывает бесконечный цикл.
    const sendMessageToAI = useCallback(async (text, context, sessionId, guestUuid, guestFingerprint) => {
        setIsLoading(true);
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'text/plain', // Оптимально для обхода CORS в Safari
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    context: context,
                    sessionId: sessionId,
                    guestUuid: guestUuid,
                    fingerprint: guestFingerprint
                }),
            });

            if (!response.ok) throw new Error(`Ошибка: ${response.status}`);

            const responseText = await response.text();
            try {
                const data = JSON.parse(responseText);
                return data.output || data.text || data.message || responseText;
            } catch {
                return responseText; // Если пришел просто текст
            }
        } catch (error) {
            console.error("API Error:", error);
            return "Ошибка связи. Попробуйте еще раз.";
        } finally {
            setIsLoading(false);
        }
    }, [webhookUrl]); // Функция обновится только если сменится адрес вебхука

    return { sendMessageToAI, isLoading };
};
