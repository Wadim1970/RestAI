import React from 'react';
import styles from './AIControlCenter.module.css';

const VideoView = ({ onSwitchToText }) => {
  return (
    <div className={styles.videoWrapper}>
      <div className={styles.videoCircle}>
        {/* ТУТ БУДЕТ ВИДЕО D-ID */}
        <div className={styles.placeholderText}>Видео-аватар</div>
      </div>
      
      <div className={styles.videoControls}>
        <button className={styles.micBtn}>
          <img src="/icons/free-icon-audio.png" alt="микрофон" />
        </button>
        <button onClick={onSwitchToText} className={styles.backBtn}>
          <img src="/icons/free-icon-chat.png" alt="в чат" />
        </button>
      </div>
    </div>
  );
};

export default VideoView;
