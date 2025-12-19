// src/components/MainScreen.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';
import styles from './MainScreen.module.css'; // Предположим, стили будут тут

const MainScreen = () => {
  const navigate = useNavigate();
  // Состояние: началось ли воспроизведение
  const [isStarted, setIsStarted] = useState(false);
  // Реф для прямого доступа к видео
  const videoRef = useRef(null);

  const handleStart = () => {
    setIsStarted(true);
    // Находим видео внутри DOM и запускаем его
    // Если в VideoBackground видео прописано правильно, это сработает
    const video = document.querySelector('video');
    if (video) {
      video.muted = false; // Теперь можно включить звук!
      video.play().catch(error => {
        console.error("Ошибка автоплея:", error);
      });
    }
  };

  const handleOpenMenu = () => {
    navigate('/menu'); 
  };

  const handleModeToggle = (newMode) => {
    console.log(`Режим общения изменен на: ${newMode}`);
  };

  return (
    <div className="main-screen-wrapper" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      
      {/* 1. Наш компонент с видео */}
      <VideoBackground />
      
      {/* 2. Оверлей с кнопкой Старт (показываем, пока не нажали) */}
      {!isStarted && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)', // Затемнение
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)'
        }}>
          <button 
            onClick={handleStart}
            style={{
              padding: '20px 60px',
              fontSize: '24px',
              backgroundColor: '#304D22',
              color: 'white',
              border: '2px solid #F5F5F5',
              borderRadius: '40px',
              cursor: 'pointer',
              fontFamily: 'Manrope, sans-serif',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
          >
            НАЧАТЬ
          </button>
        </div>
      )}

      {/* 3. Основной интерфейс (скрываем или блокируем, пока не нажали Старт) */}
      {isStarted && (
        <div className="buttons-footer"> 
          <MenuButton onClick={handleOpenMenu} />
          <ToggleChatButton onToggle={handleModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
