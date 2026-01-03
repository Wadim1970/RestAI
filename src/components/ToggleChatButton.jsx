import React, { useState } from 'react'; // Импортируем React и хук состояния

/**
 * Кнопка переключения режимов (Голос / ИИ-Чат)
 * Пути ведут в папку public/icons/ (проверь, что файлы именно там)
 */
const AudioIconSrc = '/icons/free-icon-audio.png'; // Путь к иконке микрофона
const ChatIconSrc = '/icons/free-icon-chat.png';   // Путь к иконке облачка чата

const ToggleChatButton = ({ onToggle }) => {
  // Исходное состояние: 'voice' (когда мы видим видео-аватара)
  const [mode, setMode] = useState('voice'); 

  // Функция, которая срабатывает при нажатии на кнопку
  const handleToggle = () => {
    // Если сейчас 'voice', меняем на 'chat', если 'chat' — на 'voice'
    const newMode = mode === 'voice' ? 'chat' : 'voice';
    
    // Обновляем внутреннее состояние кнопки
    setMode(newMode);
    
    // Передаем команду "наверх" в App.jsx, чтобы открыть или закрыть модалку чата
    if (onToggle) {
      onToggle(newMode);
    }
  };

  // Создаем вспомогательную переменную: true если мы в режиме чата, false если в голосе
  const isChat = mode === 'chat';

  return (
    <button 
      /* Динамически меняем класс: toggle-chat-button voice-mode ИЛИ toggle-chat-button chat-mode */
      className={`toggle-chat-button ${isChat ? 'chat-mode' : 'voice-mode'}`} 
      onClick={handleToggle} // Вешаем обработчик клика
      type="button" // Указываем тип, чтобы избежать случайных отправок форм
      aria-label="Переключить режим связи" // Описание для доступности
    >
      
      {/* 1. ИКОНКА ЧАТА (Отображается в режиме Voice) */}
      {/* Согласно твоей правке: когда мы в видео (voice), кнопка предлагает перейти в ЧАТ */}
      <img 
        src={ChatIconSrc} 
        className="chat-icon-img" // Класс для CSS (размер 31x31px)
        alt="Перейти в текстовый чат" 
      />
      
      {/* 2. ИКОНКА АУДИО (Отображается в режиме Chat) */}
      {/* Когда мы уже в чате (chat), кнопка предлагает вернуться в ГОЛОС (видео) */}
      <img 
        src={AudioIconSrc} 
        className="audio-icon-img" // Класс для CSS (размер 40x35px)
        alt="Вернуться в видео-режим" 
      />
      
    </button>
  );
};

export default ToggleChatButton; // Экспортируем компонент для использования в MainScreen
