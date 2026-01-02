// src/components/MainScreen.jsx
import React from 'react';
import VideoBackground from './VideoBackground'; // Твой видеоаватар
import MenuButton from './MenuButton';
import ToggleChatButton from './ToggleChatButton';
import { useNavigate } from 'react-router-dom';

const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate();

  return (
    <div className="main-screen">
      <VideoBackground />
      
      {/* ТВОЙ РОДНОЙ КОНТЕЙНЕР ИЗ styles.css */}
      <div className="buttons-footer">
        <MenuButton onClick={() => navigate('/menu')} />
        
        {/* ПЕРЕДАЕМ ТУТ ФУНКЦИЮ ОТКРЫТИЯ ЧАТА */}
        <ToggleChatButton onToggle={onChatModeToggle} />
      </div>
    </div>
  );
};

export default MainScreen;
