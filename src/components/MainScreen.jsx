// src/components/MainScreen.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';

const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);

  const handleStart = () => {
    setIsStarted(true);
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
        height: '100svh', // Статичная высота, не реагирует на клавиатуру
        background: '#000', 
        overflow: 'hidden',
        zIndex: 1 
      }}
    >
      <VideoBackground />

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

      {isStarted && (
        <div className="buttons-footer-fixed"> 
          <MenuButton onClick={handleOpenMenu} />
          <ToggleChatButton onToggle={handleModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
