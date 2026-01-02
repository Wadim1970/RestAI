// src/components/MainScreen.jsx
import React, { useState } from 'react';
import VideoBackground from './VideoBackground';
import MenuButton from './MenuButton';
import ToggleChatButton from './ToggleChatButton';
import { useNavigate } from 'react-router-dom';

const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();
  
  // Твои состояния видео, которые ты настраивал
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const handlePlayVideo = () => {
    console.log("Video Play Clicked"); // Для проверки в консоли
    setIsPlaying(true);
    setIsMuted(false);
  };

  return (
    <div className="main-screen" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      
      {/* 1. ВИДЕО (Z-INDEX: 1) */}
      <VideoBackground isPlaying={isPlaying} isMuted={isMuted} />
      
      {/* 2. КНОПКА ЗАПУСКА (Z-INDEX: 20 — поднимаем выше всех) */}
      {!isPlaying && (
        <button 
          className="play-video-button" 
          onClick={handlePlayVideo}
          style={{ 
            position: 'fixed', 
            zIndex: 20, 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <img src="/icons/play-icon.png" alt="Play Video" style={{ width: '80px', height: '80px' }} />
        </button>
      )}

      {/* 3. НИЖНИЕ КНОПКИ (Z-INDEX: 10) */}
      <div className="buttons-footer" style={{ zIndex: 10 }}>
        <MenuButton onClick={() => navigate('/menu')} />
        <ToggleChatButton onToggle={onChatModeToggle} />
      </div>
    </div>
  );
};

export default MainScreen;
