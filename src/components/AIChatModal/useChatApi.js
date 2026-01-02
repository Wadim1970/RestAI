import { useState } from 'react';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    const sendMessageToAI = async (text, history, context) => {
        setIsLoading(true);
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    chatHistory: history, // Предыдущие сообщения
                    context: context     // Та самая "память" о блюдах
                }),
            });
            const data = await response.json();
            return data.output; // Ждем от n8n поле output
        } catch (error) {
            console.error("n8n Error:", error);
            return "Извините, возникла ошибка при связи с сервером.";
        } finally {
            setIsLoading(false);
        }
    };

    return { sendMessageToAI, isLoading };
};
