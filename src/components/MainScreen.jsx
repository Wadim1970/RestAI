// src/components/MainScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import { isIOSDevice } from '../hooks/useDisplayMode.js';

// Старт заставки зависит от платформы:
// • Android и пр. — заставка стартует САМА сразу после скана QR (звук в
//   автоплее там работает).
// • iOS — Apple не даёт звук без жеста, поэтому до тапа показываем
//   градиентный экран со стеклянным треугольником-пуском; тап запускает
//   заставку со звуком и разблокирует аудио для приветствия ИИ.
// onIntroStart — заставка пошла: начинаем прогрев голоса под ней.
// onIntroEnd — заставка доиграла: активируем голос.
const MainScreen = ({ onIntroStart, onIntroEnd, isChatOpen }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  // Видео проявляем (opacity) только когда оно реально заиграло (onPlaying) —
  // до этого виден градиентный экран, без чёрной вспышки неготового видео.
  const [videoVisible, setVideoVisible] = useState(false);

  // iPhone/iPad, включая iPadOS, который представляется Mac'ом с тач-экраном.
  const isIOS =
    isIOSDevice() ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  // Запуск заставки: помечаем старт, играем видео с начала со звуком и
  // начинаем прогрев голоса под ним. На iOS вызывается тапом по треугольнику
  // (жест разблокирует аудио), на остальных платформах — автоматически из
  // эффекта ниже. При блокировке автоплея со звуком падаем на muted, чтобы
  // видео точно проиграло.
  const startIntro = () => {
    if (isStarted) return;
    setIsStarted(true);
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = 0;
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch((e) => console.error('Автоплей заставки не удался:', e));
      });
    }
    onIntroStart?.();
  };

  // Старт заставки: Android и пр. — сразу (звук в автоплее работает); iOS —
  // по тапу (нужен жест для звука). На iOS до тапа видео не проигрывается —
  // виден градиентный экран со стеклянным треугольником-пуском.
  useEffect(() => {
    if (!isIOS) startIntro();
    // Один раз при монтировании; startIntro стабилен на время экрана.
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
      {/* Заставка (screensaver.mp4). Стартует сама (Android) или по тапу
          треугольника (iOS) — см. startIntro. Проявляется, когда реально
          заиграла (onPlaying → videoVisible), до этого виден градиент под
          ней. По окончании — растворение (intro-gone) и активация голоса
          (см. handleVideoEnded). */}
      <VideoBackground
        onEnded={handleVideoEnded}
        onPlaying={() => setVideoVisible(true)}
        visible={videoVisible}
      />

      {/* ЭКРАН СТАРТА — ТОЛЬКО НА iOS. Apple не даёт звук без жеста, поэтому
          на iPhone/iPad показываем градиентный экран (фон обёртки) со
          стеклянным треугольником: тап запускает заставку со звуком и
          разблокирует аудио для приветствия ИИ. На Android этого экрана нет —
          заставка идёт сразу после скана. */}
      {isIOS && !isStarted && (
        <div
          onClick={startIntro}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            cursor: 'pointer',
          }}
        >
          {/* Стеклянный треугольник-«play» ~83px. Рисуем SVG (а не div с
              clip-path + backdrop-filter — та пара багует на iOS Safari:
              размытие не обрезалось по фигуре и выглядело как полупрозрачный
              квадрат). Заливка полупрозрачная (0.45→0.12) — лёгкое стекло,
              не матовое: градиент даёт отблеск сверху, яркая обводка-кромка —
              блики, снизу мягкая тень. Саму фигуру НЕ размываем (иначе весь
              треугольник расплывается). */}
          <svg
            width="83"
            height="83"
            viewBox="0 0 70 70"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: 'drop-shadow(0 3px 7px rgba(0, 0, 0, 0.35))' }}
          >
            <defs>
              <linearGradient id="introTriFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
              </linearGradient>
              <linearGradient id="introTriRim" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <path
              d="M 25.89 16.32 L 52.11 30.68 Q 60 35 52.11 39.32 L 25.89 53.68 Q 18 58 18 49 L 18 21 Q 18 12 25.89 16.32 Z"
              fill="url(#introTriFill)"
              stroke="url(#introTriRim)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

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
