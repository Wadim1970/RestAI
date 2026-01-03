import React, { useState } from 'react';

/**
 * Кнопка переключения режимов (Голос / ИИ-Чат)
 * Мы используем прямые пути к иконкам из папки public
 */
const AudioIconSrc = '/icons/free-icon-audio.png';
const ChatIconSrc = '/icons/free-icon-chat.png';

const ToggleChatButton = ({ onToggle }) => {
  // Исходное состояние: 'voice' (показываем микрофон)
  const [mode, setMode] = useState('voice'); 

  // Обработчик клика
  const handleToggle = () => {
    // Переключаем режим: если был голос, ставим чат и наоборот
    const newMode = mode === 'voice' ? 'chat' : 'voice';
    setMode(newMode);
    
    // Передаем новый режим в родительский компонент (App.jsx), чтобы открыть модалку
    if (onToggle) {
      onToggle(newMode);
    }
  };

  // Флаг для удобной проверки текущего режима в JSX
  const isChat = mode === 'chat';

  return (
    /* Контейнер toggle-chat-container больше не нужен, так как кнопка сама по себе круглая */
    <button 
      /* Добавляем класс режима, чтобы CSS скрывал/показывал нужную иконку */
      className={`toggle-chat-button ${isChat ? 'chat-mode' : 'voice-mode'}`} 
      onClick={handleToggle}
      type="button"
      aria-label="Переключить режим чата"
    >
      {/* Иконка чата (отображается только в chat-mode). 
        Размер 31x31px задан в CSS по классу .chat-icon-img 
      */}
      <img 
        src={ChatIconSrc} 
        className="chat-icon-img" 
        alt="Текстовый чат" 
      />
      
      {/* Иконка аудио (отображается только в voice-mode). 
        Размер 40x35px задан в CSS по классу .audio-icon-img 
      */}
      <img 
        src={AudioIconSrc} 
        className="audio-icon-img" 
        alt="Голосовой режим" 
      />
    </button>
  );
};

export default ToggleChatButton;
