// src/components/VideoBackground.jsx
import React from 'react';

const VIDEO_SOURCE = "/VIDEO-2025-12-07-21-42-11.mp4";

const VideoBackground = () => {
  return (
    <video 
      className="avatar-video"
      autoPlay 
      loop 
      playsInline
      // ВНИМАНИЕ: Атрибут 'muted' отсутствует, чтобы включить звук
      src={VIDEO_SOURCE}
    />
  );
};

export default VideoBackground;