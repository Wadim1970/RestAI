// src/components/MainScreen.jsx
import React from 'react';
import VideoBackground from './VideoBackground';
import MenuButton from './MenuButton';
import ToggleChatButton from './ToggleChatButton';
import { useNavigate } from 'react-router-dom';

const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();

  return (
    <div className="main-screen">
      <VideoBackground />
      
      {/* КНОПКА ЗАПУСКА ВИДЕО (Возвращена на место) */}
      <button className="play-video-button">
        <img src="/icons/play-icon.png" alt="Play Video" />
      </button>

      {/* ТВОЙ РОДНОЙ КОНТЕЙНЕР С КНОПКАМИ */}
      <div className="buttons-footer">
        <MenuButton onClick={() => navigate('/menu')} />
        
        {/* СВЯЗКА: При клике открывает модалку чата */}
        <ToggleChatButton onToggle={onChatModeToggle} />
      </div>
    </div>
  );
};

export default MainScreen;
