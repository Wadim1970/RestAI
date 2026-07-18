// src/components/VideoBackground.jsx
import React from 'react';

const VIDEO_SOURCE = "/intro-logo.mp4";

// Раньше было loop — крутилось по кругу. Теперь проигрывается один раз за
// сеанс, а по окончании onEnded уводит гостя дальше (в меню) — не нужно
// пересматривать одно и то же видео, если задержался на этом экране.
const VideoBackground = ({ onEnded }) => {
  return (
    <video
      className="avatar-video"
      autoPlay
      playsInline
      onEnded={onEnded}
      // ВНИМАНИЕ: Атрибут 'muted' отсутствует, чтобы включить звук
      src={VIDEO_SOURCE}
    />
  );
};

export default VideoBackground;