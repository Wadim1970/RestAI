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
  <button 
    className={`toggle-chat-button ${isChat ? 'chat-mode' : 'voice-mode'}`} 
    onClick={handleToggle}
  >
    <img src="/free-icon-chat.png" className="chat-icon-img" alt="Chat" />
    <img src="/free-icon-audio.png" className="audio-icon-img" alt="Audio" />
  </button>
);
};

export default ToggleChatButton;
