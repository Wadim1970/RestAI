import React, { useState, useEffect, useRef } from 'react';
import styles from './AIChatModal.module.css';
import { useChatApi } from './useChatApi';

const AIChatModal = ({ isOpen, onClose, viewHistory = [] }) => {
    const [messages, setMessages] = useState([
        { id: 1, text: "Привет! Я ваш ИИ-шеф. Что вам подсказать по меню?", isBot: true }
    ]);
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef(null);
    
    // Вставь сюда свой URL из n8n
    const { sendMessageToAI, isLoading } = useChatApi('ТВОЙ_WEBHOOK_URL_N8N');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMsg = { id: Date.now(), text: inputValue, isBot: false };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');

        const context = {
            lastViewed: viewHistory.slice(-3), // Передаем последние 3 просмотра
            timestamp: new Date().toLocaleTimeString()
        };

        const botResponseText = await sendMessageToAI(inputValue, messages, context);
        
        setMessages(prev => [...prev, { 
            id: Date.now() + 1, 
            text: botResponseText, 
            isBot: true 
        }]);
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.videoContainer}>
                <video src="/videos/avatar-bg.mp4" autoPlay loop muted playsInline />
                <div className={styles.blurOverlay} />
            </div>

            <div className={styles.chatArea}>
                {messages.map(msg => (
                    <div key={msg.id} className={msg.isBot ? styles.botBubble : styles.userBubble}>
                        {msg.text}
                    </div>
                ))}
                {isLoading && <div className={styles.botBubble}>Думаю...</div>}
                <div ref={messagesEndRef} />
            </div>

            <div className={styles.controlCard}>
                <input 
                    className={styles.chatInput}
                    placeholder="Вам помочь с выбором блюд?"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <div className={styles.actionRow}>
                    <button className={styles.backToMenu} onClick={onClose}>
                        <div className={styles.gridIcon}><span></span><span></span><span></span><span></span></div>
                        Открыть меню
                    </button>
                    <div className={styles.rightActions}>
                        <button className={styles.iconBtn}><img src="/icons/volume.svg" alt="audio" /></button>
                        <button className={`${styles.iconBtn} ${styles.sendBtn}`} onClick={handleSend}>
                            <img src="/icons/chat-dots.svg" alt="send" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIChatModal;
