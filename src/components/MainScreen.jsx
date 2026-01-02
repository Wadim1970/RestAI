// src/components/MainScreen.jsx
import React, { useState } from 'react';
import VideoBackground from './VideoBackground';
import MenuButton from './MenuButton';
import ToggleChatButton from './ToggleChatButton';
import { useNavigate } from 'react-router-dom';

const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();
  
  // ТВОИ РОДНЫЕ ФУНКЦИИ И СОСТОЯНИЯ ВИДЕО
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const handlePlayVideo = () => {
    setIsPlaying(true);
    setIsMuted(false);
  };

  return (
    <div className="main-screen">
      {/* Твой VideoBackground с твоими пропсами */}
      <VideoBackground isPlaying={isPlaying} isMuted={isMuted} />
      
      {/* ТВОЯ КНОПКА ЗАПУСКА ВИДЕО — РОДНАЯ ЛОГИКА */}
      {!isPlaying && (
        <button className="play-video-button" onClick={handlePlayVideo}>
          <img src="/icons/play-icon.png" alt="Play Video" />
        </button>
      )}

      {/* ТВОЙ КОНТЕЙНЕР КНОПОК ИЗ styles.css */}
      <div className="buttons-footer">
        <MenuButton onClick={() => navigate('/menu')} />
        
        {/* Добавляем ТОЛЬКО передачу функции для чата */}
        <ToggleChatButton onToggle={onChatModeToggle} />
      </div>
    </div>
  );
};

export default MainScreen;
