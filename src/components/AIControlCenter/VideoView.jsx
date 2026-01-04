import React from 'react';
import styles from './AIControlCenter.module.css'; // Тот же CSS файл

const VideoView = ({ onSwitchToText }) => {
  return (
    <div className={styles['modal-glassContainer']}>
      
      {/* КОНТЕЙНЕР ДЛЯ ВИДЕО (Вместо истории чата) */}
      <div className={styles['videoLayout']}>
        {/* Сюда ты позже вставишь компонент плеера или <iframe> от D-ID */}
        <div style={{ 
          width: '100%', 
          height: '100%', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          color: 'rgba(255,255,255,0.3)' 
        }}>
          {/* Заглушка, пока нет видео */}
          <video 
            className={styles['avatarVideo']}
            src="/video/ai-avatar-placeholder.mp4" 
            autoPlay 
            loop 
            muted 
            playsInline
          />
        </div>
      </div>

      {/* НИЖНЯЯ ПАНЕЛЬ (ФУТЕР) — Копия по высоте и стилю из текстового чата */}
      <div className={styles['modal-footerControls']}>
        
        {/* Пустая или информационная плашка вместо ввода текста, чтобы сохранить геометрию */}
        <div className={styles['modal-inputWrapper']} style={{ justifyContent: 'center' }}>
          <span style={{ color: 'white', opacity: 0.7, fontFamily: 'Manrope' }}>
            Режим видео-общения
          </span>
        </div>

        {/* ЗЕЛЕНАЯ КНОПКА (СПРАВА) — Теперь возвращает в чат */}
        <button 
          className={styles['modal-actionButton']} 
          onClick={onSwitchToText}
        >
          {/* Иконка чата, сигнализирующая о возврате к тексту */}
          <img 
            src="/icons/free-icon-chat.png" 
            className={styles['modal-iconSend']} 
            alt="Вернуться в чат" 
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </button>
      </div>
    </div>
  );
};

export default VideoView;
