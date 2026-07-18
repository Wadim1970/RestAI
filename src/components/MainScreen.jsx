// src/components/MainScreen.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoBackground from './VideoBackground.jsx';
import MenuButton from './MenuButton.jsx';
import { isIOSDevice } from '../hooks/useDisplayMode.js';

// Старт заставки зависит от платформы:
// • Android и пр. — заставка стартует САМА сразу после скана QR (звук в
//   автоплее там работает).
// • iOS — Apple не даёт звук без жеста пользователя, поэтому показываем экран
//   с кнопкой пуска; тап по ней и запускает заставку, и разблокирует звук
//   (видео играет со звуком → аудио-сессия iOS активна → приветствие ИИ
//   потом тоже звучит). Без кнопки на iPhone всё было немым.
// onIntroStart — заставка пошла: начинаем прогрев голоса под ней.
// onIntroEnd — заставка доиграла: активируем голос.
const MainScreen = ({ onIntroStart, onIntroEnd, isChatOpen }) => {
  const navigate = useNavigate();
  const [isStarted, setIsStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);

  // iPhone/iPad, включая iPadOS, который представляется Mac'ом с тач-экраном.
  const isIOS =
    isIOSDevice() ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  // Запуск заставки: помечаем старт, играем видео (со звуком; при блокировке
  // автоплея — muted, чтобы анимация точно проиграла) и начинаем прогрев
  // голоса под ней. На iOS вызывается тапом по кнопке (жест = разблокировка
  // звука), на остальных платформах — автоматически из эффекта ниже.
  const startIntro = () => {
    if (isStarted) return;
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
  };

  // Автостарт — только НЕ на iOS. На iOS ждём тап по кнопке пуска.
  useEffect(() => {
    if (isIOS) return;
    startIntro();
    // Один раз при монтировании; startIntro/onIntroStart стабильны на время экрана.
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
      {/* Заставка (анимация логотипа). Стартует сама (Android) или по тапу
          кнопки пуска (iOS) — см. startIntro. По окончании активируем уже
          прогретый голосовой чат (см. handleVideoEnded). */}
      <VideoBackground onEnded={handleVideoEnded} />

      {/* ЭКРАН СТАРТА С КНОПКОЙ — ТОЛЬКО НА iOS. Apple не даёт звук без жеста,
          поэтому на iPhone/iPad показываем логотип-заставку с кнопкой: тап
          запускает видео со звуком и разблокирует аудио для приветствия ИИ.
          На Android этого экрана нет — заставка идёт сразу после скана. */}
      {isIOS && !isStarted && (
        <div
          onClick={startIntro}
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
            cursor: 'pointer',
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
            marginBottom: '20px',
          }}>
            <div style={{
              width: 0,
              height: 0,
              borderTop: '15px solid transparent',
              borderBottom: '15px solid transparent',
              borderLeft: '25px solid white',
              marginLeft: '5px',
            }} />
          </div>
          <span style={{
            color: 'white',
            fontWeight: 'bold',
            fontSize: '18px',
            letterSpacing: '2px',
          }}>
            НАЖМИТЕ, ЧТОБЫ ВОЙТИ
          </span>
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
