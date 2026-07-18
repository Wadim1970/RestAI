// src/components/MainScreen.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';

// onIntroStart — гость нажал «войти», заставка пошла: начинаем прогрев
// голоса под ней. onIntroEnd — заставка доиграла: активируем голос.
const MainScreen = ({ onIntroStart, onIntroEnd, isChatOpen }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);

  const handleStart = () => {
    setIsStarted(true);
    const video = document.querySelector('video');
    if (video) {
      video.muted = false; // клик пользователя — можно со звуком
      video.play().catch((error) => console.error('Ошибка автоплея:', error));
    }
    // Одновременно с заставкой начинаем прогрев голоса под ней.
    onIntroStart?.();
  };

  const handleVideoEnded = () => {
    setVideoEnded(true);
    onIntroEnd?.(); // активируем голос: микрофон + приветствие
  };

  const handleOpenMenu = () => {
    navigate('/menu');
  };

  // Пока заставка играет — весь экран поверх голосового чата (тот молча
  // прогревается под ним). Как только видео кончилось — экран гаснет и
  // уходит вниз по слою, открывая уже прогретый голосовой чат.
  const overlayActive = isStarted && !videoEnded;

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
        // Поверх AIChatModal (z-index 999999), пока идёт заставка; после — под ним.
        zIndex: overlayActive ? 1000005 : 1,
        opacity: videoEnded ? 0 : 1,
        transition: 'opacity 0.4s ease',
        pointerEvents: videoEnded ? 'none' : 'auto',
      }}
    >
      {/* Заставка (анимация логотипа). По окончании — активируем уже
          прогретый голосовой чат (см. handleVideoEnded). */}
      <VideoBackground onEnded={handleVideoEnded} />

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
            
            fontWeight: 'bold',
            fontSize: '18px',
            letterSpacing: '2px'
          }}>
            НАЖМИТЕ, ЧТОБЫ ВОЙТИ
          </span>
        </div>
      )}

      {/* НИЖНЯЯ КНОПКА (Меню) - появляется только после handleStart. Кнопки
          чата тут больше нет — голосовой ИИ теперь включается сам по
          окончании видео, вернуться к нему можно кнопкой "Чат" в меню.
          Скрываем на время открытого чата — AIChatModal поверх рисует
          свою такую же кнопку в том же месте; без !isChatOpen обе
          копии остаются в DOM одновременно (MainScreen не размонтируется,
          когда открывается чат поверх него), и еле заметное несовпадение
          пикселей между ними даёт светлый обвод одной кнопки, выглядывающий
          из-за другой. */}
      {isStarted && !isChatOpen && (
        <div className="buttons-footer-fixed">
          <MenuButton onClick={handleOpenMenu} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
