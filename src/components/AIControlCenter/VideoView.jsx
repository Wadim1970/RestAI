import React from 'react';
import styles from './AIControlCenter.module.css';

const VideoView = ({ onSwitchToText }) => {
  return (
    <>
      {/* КОНТЕЙНЕР ДЛЯ ВИДЕО */}
      <div className={styles['videoLayout']}>
          <video 
            className={styles['avatarVideo']}
            src="/video/ai-avatar-placeholder.mp4" 
            autoPlay loop muted playsInline
          />
      </div>

      {/* НИЖНЯЯ ПАНЕЛЬ */}
      <div className={styles['modal-footerControls']}>
        <div className={styles['modal-inputWrapper']} style={{ justifyContent: 'center' }}>
          <span style={{ color: 'white', opacity: 0.7, fontFamily: 'Manrope' }}>
            Режим видео-общения
          </span>
        </div>
        <button className={styles['modal-actionButton']} onClick={onSwitchToText}>
          <img 
            src="/icons/free-icon-chat.png" 
            className={styles['modal-iconSend']} 
            alt="Вернуться в чат" 
          />
        </button>
      </div>
    </>
  );
};

export default VideoView;
