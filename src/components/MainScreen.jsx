// src/components/MainScreen.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom'; // <-- Добавляем хук
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import ToggleChatButton from './ToggleChatButton.jsx';

const MainScreen = () => {
  const navigate = useNavigate(); // <-- Инициализируем навигацию

  const handleOpenMenu = () => {
    // Вместо alert() используем navigate для перехода на новый маршрут
    navigate('/menu'); 
  };

  const handleModeToggle = (newMode) => {
    console.log(`Режим общения изменен на: ${newMode}`);
  };

  return (
    <div className="main-screen-wrapper">
      <VideoBackground />
      
      <div className="buttons-footer"> 
        <MenuButton onClick={handleOpenMenu} /> {/* Кнопка теперь переходит */}
        <ToggleChatButton onToggle={handleModeToggle} />
      </div>
    </div>
  );
};

export default MainScreen;