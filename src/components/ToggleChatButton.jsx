import React from 'react'; // Убрали { useState }, так как кнопка теперь не хранит состояние внутри себя

/**
 * Кнопка переключения режимов (Голос / ИИ-Чат)
 * Эти пути указывают на папку public/icons/. 
 * Браузер ищет их в корневой директории сборки.
 */
const ChatIconSrc = '/icons/free-icon-chat.png';   // Переменная с путем к иконке чата

// Основной компонент кнопки, принимает пропс onToggle (функцию из родителя App.jsx через MainScreen.jsx)
const ToggleChatButton = ({ onToggle }) => {
  
  /**
   * Упрощенная функция обработки клика
   * Теперь она просто сообщает App.js, что нужно открыть центр управления в текстовом режиме.
   */
  const handleClick = () => {
    if (onToggle) {
      // Передаем 'text', чтобы AIControlCenter открылся именно в режиме текстового чата
      onToggle('text');
    }
  };

  /**
   * РЕНДЕР КНОПКИ
   * Теперь кнопка статична — она всегда показывает иконку чата и служит "входом" в ИИ-центр.
   */
  return (
    <button 
      className="toggle-chat-button" // Класс для внешних стилей
      onClick={handleClick}          // При клике открываем чат в новом модальном окне
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
        width: '13.18vw',            // Фиксированный размер самой кнопки
        height: '13.18vw'            
      }}
    >
      {/* Всегда отображаем иконку ЧАТА, так как это первая точка входа */}
      <img 
        src={ChatIconSrc}            // Источник: иконка облачка
        className="chat-icon-img"    
        alt="Open AI Chat"           
        style={{ 
          width: '7.05vw',           // Твой размер пропорционально экрану
          height: '7.05vw',          
          objectFit: 'contain',      
          filter: 'brightness(0) invert(1)' // Делаем иконку БЕЛОЙ (инверсия цвета)
        }} 
      />
    </button>
  );
};

export default ToggleChatButton; // Экспортируем компонент
