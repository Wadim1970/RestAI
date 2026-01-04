import React from 'react';
import TextView from './TextView';
import VideoView from './VideoView';
import styles from './AIControlCenter.module.css';

const AIControlCenter = ({ isOpen, mode, onClose, onModeChange, viewHistory }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modalContainer}>
        {/* Общая кнопка закрытия для всех режимов */}
        <button className={styles.closeBtn} onClick={onClose}>
          <img src="/icons/icon-on.png" alt="Закрыть" />
        </button>

        {mode === 'text' ? (
          <TextView 
            onSwitchToVideo={() => onModeChange('video')} 
            viewHistory={viewHistory} 
          />
        ) : (
          <VideoView 
            onSwitchToText={() => onModeChange('text')} 
          />
        )}
      </div>
    </div>
  );
};

export default AIControlCenter;
