// src/components/VideoBackground.jsx
import React from 'react';

const VIDEO_SOURCE = "/screensaver.mp4";

// Заставка проигрывается один раз за сеанс; по окончании onEnded уводит
// дальше (растворение → голосовой экран). autoPlay намеренно нет — стартом
// управляет MainScreen (video.play()): на Android сразу, на iOS по тапу
// (жест разрешает звук). visible=false держит видео прозрачным, пока оно
// реально не заиграло (onPlaying) — до этого виден градиентный экран под
// ним, без чёрной вспышки ещё неготового видео.
const VideoBackground = ({ onEnded, onPlaying, visible = true }) => {
  return (
    <video
      className="avatar-video"
      playsInline
      preload="auto"
      onEnded={onEnded}
      onPlaying={onPlaying}
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease' }}
      // ВНИМАНИЕ: Атрибут 'muted' отсутствует, чтобы включить звук
      src={VIDEO_SOURCE}
    />
  );
};

export default VideoBackground;
