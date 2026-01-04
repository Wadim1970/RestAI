import React, { useState } from 'react'; // Подключаем библиотеку React и хук useState для управления состоянием

/**
 * Кнопка переключения режимов (Голос / ИИ-Чат)
 * Эти пути указывают на папку public/icons/. 
 * Браузер ищет их в корневой директории сборки.
 */
const ChatIconSrc = '/icons/free-icon-chat.png';   // Переменная с путем к иконке чата

// Основной компонент кнопки, принимает пропс onToggle (функцию из родителя App.jsx)
const ToggleChatButton = ({ onToggle }) => {
  
  // Упрощенная функция обработки клика
  const handleClick = () => {
    // Просто вызываем функцию открытия, передавая режим 'chat'
    // В App.js это сработает как setIsChatOpen(true)
    if (onToggle) {
      onToggle('chat');
    }
  };

  /**
   * РЕНДЕР КНОПКИ
   * Здесь решается, какая иконка будет внутри в зависимости от mode
   */
 return (
    <button 
      className="toggle-chat-button" // Класс для внешних стилей
      onClick={handleClick}          // При клике открываем чат
      type="button"                  // Стандарт для кнопок
      style={{
        display: 'flex',             // Центрирование иконки
        justifyContent: 'center',    
        alignItems: 'center',        
        padding: 0,                  
        backgroundColor: '#48BF48',  // Твой зеленый цвет
        borderRadius: '50%',         // Круглая форма
        border: 'none',              
        cursor: 'pointer',           
        width: '13.18vw',            // Добавим фиксированный размер самой кнопки (около 58px)
        height: '13.18vw'            // Чтобы она была пропорциональна иконке
      }}
    >
      {/* Всегда отображаем иконку ЧАТА */}
      <img 
        src={ChatIconSrc}            // Источник: иконка облачка
        className="chat-icon-img"    
        alt="Open AI Chat"           
        style={{ 
          width: '7.05vw',           // Твой размер 31px
          height: '7.05vw',          
          objectFit: 'contain',      
          filter: 'brightness(0) invert(1)' // Делаем иконку БЕЛОЙ
        }} 
      />
    </button>
  );
};

export default ToggleChatButton; // Экспортируем компонент для использования в MainScreen.jsx
