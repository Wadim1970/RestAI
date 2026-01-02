// src/components/MainScreen.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';

// ВАЖНО: Принимаем onChatModeToggle из App.jsx
const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);

  const handleStart = () => {
    setIsStarted(true);
    // Твоя оригинальная логика поиска видео
    const video = document.querySelector('video');
    if (video) {
      video.muted = false; 
      video.play().catch(error => {
        console.error("Ошибка автоплея:", error);
      });
    }
  };

  const handleOpenMenu = () => {
    navigate('/menu'); 
  };

  // Используем функцию из пропсов, чтобы открыть модалку
  const handleModeToggle = (newMode) => {
    if (onChatModeToggle) {
        onChatModeToggle(newMode);
    }
  };

  return (
    <div 
      className="main-screen-wrapper" 
      style={{ 
        position: 'fixed', // ИСПРАВЛЕНО: фиксируем, чтобы не поднималось клавиатурой
        top: 0,
        left: 0,
        width: '100vw', 
        height: '100vh', 
        background: '#000', 
        overflow: 'hidden',
        zIndex: 1 
      }}
    >

      {/* 1. Видео всегда на фоне */}
      <VideoBackground />

      {/* 2. Оверлей с кнопкой Старт (Твой оригинальный дизайн из GitHub) */}
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
          {/* Тот самый зеленый круг с треугольником */}
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

      {/* 3. Основной интерфейс (появляется после старта) */}
      {isStarted && (
        <div className="buttons-footer"> 
          <MenuButton onClick={handleOpenMenu} />
          {/* Вставляем handleModeToggle для вызова чата */}
          <ToggleChatButton onToggle={handleModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
