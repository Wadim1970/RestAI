import { useState, useCallback } from 'react';

export const useChatApi = (webhookUrl) => {
    const [isLoading, setIsLoading] = useState(false);

    const sendMessageToAI = useCallback(async (text, context, sessionId, guestUuid, guestFingerprint) => {
        setIsLoading(true);
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    context: context,
                    sessionId: sessionId,
                    guestUuid: guestUuid,
                    fingerprint: guestFingerprint
                }),
            });

            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const responseText = await response.text();
            try {
                const data = JSON.parse(responseText);
                return data.output || data.text || data.message || responseText;
            } catch {
                return responseText;
            }
        } catch (error) {
            console.error("API Error:", error);
            return "Ошибка связи.";
        } finally {
            setIsLoading(false);
        }
    }, [webhookUrl]);

    return { sendMessageToAI, isLoading };
};
