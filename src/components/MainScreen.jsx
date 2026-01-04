// src/components/MainScreen.jsx
// src/components/MainScreen.jsx
import React, { useState, useEffect } from 'react'; // Добавили useEffect для слежения за состоянием чата
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';

// Добавляем пропс isChatOpen, который приходит из App.js через Routes
const MainScreen = ({ onChatModeToggle, isChatOpen }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);

  /**
   * ЭФФЕКТ УПРАВЛЕНИЯ ПАУЗОЙ
   * Этот хук срабатывает каждый раз, когда меняется статус isChatOpen (открыт/закрыт чат)
   */
  useEffect(() => {
    // Находим элемент видео в DOM
    const video = document.querySelector('video');
    
    // Если видео найдено и пользователь уже нажал кнопку "Войти" (isStarted)
    if (video && isStarted) {
      if (isChatOpen) {
        // Если чат открылся — ставим видео на паузу
        video.pause();
      } else {
        // Если чат закрылся — продолжаем воспроизведение
        video.play().catch(error => {
          // Игнорируем возможные ошибки автоплея при возврате из чата
          console.error("Ошибка при возобновлении видео:", error);
        });
      }
    }
  }, [isChatOpen, isStarted]); // Следим за этими двумя переменными

  const handleStart = () => {
    setIsStarted(true);
    // Находим видео при первом клике ("Нажмите, чтобы войти")
    const video = document.querySelector('video');
    if (video) {
      video.muted = false; // Включаем звук, так как был клик пользователя
      video.play().catch(error => {
        console.error("Ошибка автоплея:", error);
      });
    }
  };

  const handleOpenMenu = () => {
    navigate('/menu'); 
  };

  const handleModeToggle = (newMode) => {
    if (onChatModeToggle) {
      onChatModeToggle(newMode);
    }
  };

  return (
    <div 
      className="main-screen-wrapper" 
      style={{ 
        position: 'fixed', 
        top: 0,
        left: 0,
        width: '100vw', 
        height: '100svh', // Статичная высота (Small Viewport Height)
        background: '#000', 
        overflow: 'hidden',
        zIndex: 1 
      }}
    >
      {/* Компонент с самим тегом <video> */}
      <VideoBackground />

      {/* ЭКРАН СТАРТА (Затемнение и кнопка Play) */}
      {!isStarted && (
        <div 
          onClick={handleStart} 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.3)', 
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            cursor: 'pointer'
          }}
        >
          {/* Круг со стрелкой */}
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(48, 77, 34, 0.9)', 
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            border: '2px solid white',
            marginBottom: '20px'
          }}>
            <div style={{
              width: 0,
              height: 0,
              borderTop: '15px solid transparent',
              borderBottom: '15px solid transparent',
              borderLeft: '25px solid white',
              marginLeft: '5px'
            }}></div>
          </div>
          
          <span style={{ 
            color: 'white', 
            fontFamily: 'Manrope, sans-serif', 
            fontWeight: 'bold',
            fontSize: '18px',
            letterSpacing: '2px'
          }}>
            НАЖМИТЕ, ЧТОБЫ ВОЙТИ
          </span>
        </div>
      )}

      {/* НИЖНИЕ КНОПКИ (Меню и Чат) - появляются только после handleStart */}
      {isStarted && (
        <div className="buttons-footer-fixed"> 
          <MenuButton onClick={handleOpenMenu} />
          {/* Кнопка открытия чата */}
          <ToggleChatButton onToggle={handleModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
