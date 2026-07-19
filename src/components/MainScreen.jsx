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
          {/* Кнопка пуска в стиле Telegram (play/pause поверх видео): КРУГ с
              эффектом матового стекла. Ключевое — backdrop-filter размывает
              ФОН ПОЗАДИ кнопки (настоящий «эффект стекла»), а сама иконка
              остаётся чёткой. Круг + backdrop-filter на iOS работают надёжно
              (в отличие от треугольника через clip-path, где размытие не
              обрезалось по фигуре). Фрост ярче виден на пёстром фоне; на
              градиенте — мягкое полупрозрачное стекло. */}
          <div
            style={{
              width: '78px',
              height: '78px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              border: '1px solid rgba(255, 255, 255, 0.30)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Чёткая иконка play (её НЕ размываем) */}
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: '13px solid transparent',
                borderBottom: '13px solid transparent',
                borderLeft: '22px solid #fff',
                marginLeft: '5px',
                filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25))',
              }}
            />
          </div>
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
