// src/components/MainScreen.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';

const MainScreen = () => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);

  const handleStart = () => {
    const video = document.querySelector('video');
    if (video) {
      video.muted = false; 
      video.play();
    }
    setIsStarted(true);
  };

  const handleOpenMenu = () => {
    navigate('/menu'); 
  };

  return (
    <div className="main-screen-wrapper" style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
      
      {/* Видео всегда на фоне */}
      <VideoBackground />
      
      {/* Слой, который ловит клик для старта */}
      {!isStarted && (
        <div 
          onClick={handleStart} // Клик в любое место запускает видео
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.3)', // Легкое затемнение
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            cursor: 'pointer'
          }}
        >
          {/* Иконка Play или просто текст */}
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(48, 77, 34, 0.9)', // Твой зеленый
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

      {/* Интерфейс кнопок (появляется только после старта) */}
      {isStarted && (
        <div className="buttons-footer"> 
          <MenuButton onClick={handleOpenMenu} />
          <ToggleChatButton onToggle={props.onChatModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
