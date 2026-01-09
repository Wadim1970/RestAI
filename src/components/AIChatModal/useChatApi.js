import { useState } from 'react';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    const sendMessageToAI = async (text, context, sessionId = 'default-user') => {
        setIsLoading(true);
        try {
            // ВАЖНО: используем именно те имена, которые пришли в аргументы (text, context, sessionId)
            const response = await fetch(webhookUrl, {
                method: 'POST',
                mode: 'cors', 
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                // Убираем лишние вложенности, шлем чистый объект
                body: JSON.stringify({
                    message: text,     // было userText (ошибка)
                    context: context,  // было pageContext (ошибка)
                    userId: sessionId  // было userId (ошибка)
                }),
            });
            
            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            const responseText = await response.text();
            
            try {
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
