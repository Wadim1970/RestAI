import React from 'react';

// Пути к иконкам
const ChatIconSrc = '/icons/free-icon-chat.png';
const AudioIconSrc = '/icons/free-icon-audio.png'; // Добавили недостающую переменную

const ToggleChatButton = ({ onToggle, isChatOpen }) => {
  
  // Исправили название функции, чтобы она совпадала с onClick
  const handleToggle = () => {
    if (onToggle) {
      // Если чат закрыт — открываем его. Если открыт — переключаем (или закрываем)
      onToggle('chat');
    }
  };

  return (
    <button 
      className="toggle-chat-button"
      onClick={handleToggle} // Теперь функция существует
      type="button"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 0,
        backgroundColor: '#48BF48',
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        width: '58px',  // Добавил фиксированный размер кнопке, чтобы она не схлопнулась
        height: '58px'
      }}
    >
      {/* Используем пропс isChatOpen вместо неопределенного mode */}
      {!isChatOpen ? (
        <img 
          src={ChatIconSrc}
          alt="Open Chat"
          style={{ 
            width: '31px', 
            height: '31px', 
            objectFit: 'contain',
            filter: 'brightness(0) invert(1)' 
          }} 
        />
      ) : (
        <img 
          src={AudioIconSrc}
          alt="Switch to Voice"
          style={{ 
            width: '40px', 
            height: '35px', 
            objectFit: 'contain',
            filter: 'brightness(0) invert(1)' 
          }}
        />
      )}
    </button>
  );
};

export default ToggleChatButton;
