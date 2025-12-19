// src/components/ToggleChatButton.jsx
import React, { useState } from 'react';

// Предполагаем, что иконки будут доступны в папке public и импортированы как изображения
// В Vite/React мы используем прямые пути к public/
const AudioIconSrc = '/icons/free-icon-audio.png';
const ChatIconSrc = '/icons/free-icon-chat.png';

const ToggleChatButton = ({ onToggle }) => {
  // Исходное состояние: 'voice' (голосовое общение)
  const [mode, setMode] = useState('voice'); 

  const handleToggle = () => {
    const newMode = mode === 'voice' ? 'chat' : 'voice';
    setMode(newMode);
    // Вызов функции-обработчика, переданной из родителя
    if (onToggle) {
        onToggle(newMode); 
    }
  };

  return (
    <div className="toggle-chat-container">
        <button className="toggle-chat-button" onClick={handleToggle}>
            
            {/* Переключатель (Зеленый круг) */}
            <div 
                // Класс 'voice' или 'chat' будет управлять CSS-анимацией
                className={`mode-toggle-circle ${mode}`}
            ></div>

            {/* Иконка Голоса (Звуковая волна) */}
            <img 
                src={AudioIconSrc}
                alt="Voice Mode"
                className="icon audio-icon" 
            />

            {/* Иконка Чата (Пузырь чата) */}
            <img 
                src={ChatIconSrc}
                alt="Chat Mode"
                className="icon chat-icon" 
            />

        </button>
    </div>
  );
};

export default ToggleChatButton;