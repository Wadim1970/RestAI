// src/components/VideoBackground.jsx
import React from 'react';

const VIDEO_SOURCE = "/intro-logo.mp4";

// Раньше было loop — крутилось по кругу. Теперь проигрывается один раз за
// сеанс, а по окончании onEnded уводит гостя дальше (в меню) — не нужно
// пересматривать одно и то же видео, если задержался на этом экране.
//
// ВАЖНО: autoPlay убран намеренно. Со autoPlay видео на Android стартовало
// само, ещё до клика гостя — из-за этого handleStart не вызывался, кнопка
// «войти» не исчезала, прогрев голоса не запускался, а по концу заставки
// оставался белый экран. Теперь видео стартует строго по клику
// (video.play() в MainScreen.handleStart) — детерминированно на всех
// платформах, и клик же является жестом пользователя, разрешающим звук.
const VideoBackground = ({ onEnded }) => {
  return (
    <video
      className="avatar-video"
      playsInline
      preload="auto"
      onEnded={onEnded}
      // ВНИМАНИЕ: Атрибут 'muted' отсутствует, чтобы включить звук
      src={VIDEO_SOURCE}
    />
  );
};

export default VideoBackground;