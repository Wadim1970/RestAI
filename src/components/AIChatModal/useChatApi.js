import { useState } from 'react';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    // Добавляем sessionId, чтобы n8n мог привязать историю к конкретному юзеру в Redis
    const sendMessageToAI = async (text, context, sessionId = 'default-user') => {
        setIsLoading(true);
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    context: context,      // Информация о блюде/странице
                    sessionId: sessionId   // Уникальный ID для Redis/Memory
                }),
            });
            const data = await response.json();
            
            // n8n обычно возвращает ответ в поле output или data
            return data.output || data.text || data.message; 
        } catch (error) {
            console.error("n8n Error:", error);
            return "Извините, я немного отвлекся. Повторите, пожалуйста!";
        } finally {
            setIsLoading(false);
        }
    };

    return { sendMessageToAI, isLoading };
};
