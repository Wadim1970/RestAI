// src/components/MainScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';

// Кнопки «войти» больше нет — заставка стартует сама сразу после скана QR
// (см. useEffect ниже). onIntroStart — заставка пошла: начинаем прогрев
// голоса под ней. onIntroEnd — заставка доиграла: активируем голос.
const MainScreen = ({ onIntroStart, onIntroEnd, isChatOpen }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);

  // Автостарт заставки при монтировании (после скана QR/InstallPromo) — без
  // кнопки и жеста. Видео пробуем со звуком; если политика автоплея не даёт
  // звук без жеста (iOS всегда) — падаем на muted, чтобы анимация точно
  // проиграла. Звук приветствия ИИ разблокирует первое касание экрана —
  // невидимый unlock живёт в VoiceStage (ФАЗА 1).
  useEffect(() => {
    setIsStarted(true);
    const video = document.querySelector('video');
    if (video) {
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch((e) => console.error('Автоплей заставки не удался:', e));
      });
    }
    onIntroStart?.();
    // Один раз при монтировании; onIntroStart стабилен на время экрана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Слоем управляем классами, а не inline-стилем: z-index у
      // .main-screen-wrapper стоит с !important, и inline его не
      // переопределял. intro-active поднимает обёртку поверх голосового
      // чата, пока играет заставка; intro-gone — гасит её после.
      className={`main-screen-wrapper${overlayActive ? ' intro-active' : ''}${
        videoEnded ? ' intro-gone' : ''
      }`}
    >
      {/* Заставка (анимация логотипа). Стартует сама (см. useEffect выше),
          по окончании — активируем уже прогретый голосовой чат
          (см. handleVideoEnded). Экрана-заглушки с кнопкой «войти» больше
          нет: гость сразу видит анимацию сразу после скана QR. */}
      <VideoBackground onEnded={handleVideoEnded} />

      {/* НИЖНЯЯ КНОПКА (Меню) - появляется только после старта. Кнопки
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
