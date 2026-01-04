import React from 'react';
import TextView from './TextView';
import VideoView from './VideoView';
import styles from './AIControlCenter.module.css';

const AIControlCenter = ({ isOpen, mode, onClose, onModeChange, viewHistory }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      {/* ВНИМАНИЕ: Здесь была ошибка! 
          Заменяем modalContainer на твой modal-glassContainer 
      */}
      <div className={styles['modal-glassContainer']}>
        
        {/* Заменяем closeBtn на твой modal-closeBtn */}
        <button className={styles['modal-closeBtn']} onClick={onClose}>
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
