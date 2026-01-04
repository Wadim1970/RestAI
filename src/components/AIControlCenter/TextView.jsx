import React, { useState } from 'react';
import { useChatApi } from './useChatApi';
import styles from './AIControlCenter.module.css';

const TextView = ({ onSwitchToVideo, viewHistory }) => {
  const [inputValue, setInputValue] = useState('');
  const { messages, sendMessage, isLoading } = useChatApi(viewHistory);

  const handleActionClick = () => {
    if (inputValue.trim().length > 0) {
      if (sendMessage) sendMessage(inputValue);
      setInputValue('');
    } else {
      onSwitchToVideo();
    }
  };

  return (
    <>
      {/* ИСТОРИЯ ЧАТА */}
      <div className={styles['modal-chatHistory']}>
        <div className={styles['modal-botMessage']}>Чем я могу вам помочь?</div>
        {messages && messages.map((msg, index) => (
          <div key={index} className={msg.role === 'assistant' ? styles['modal-botMessage'] : styles['modal-userMessage']}>
            {msg.content}
          </div>
        ))}
        {isLoading && <div className={styles['modal-botMessage']}>...</div>}
      </div>

      {/* ФУТЕР */}
      <div className={styles['modal-footerControls']}>
        <div className={styles['modal-inputWrapper']}>
          <img src="/icons/free-icon-main-menu-2.png" className={styles['modal-menuInInput']} alt="Меню" />
          <textarea 
            className={styles['modal-textArea']}
            placeholder="Напишите сообщение..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
        <button className={styles['modal-actionButton']} onClick={handleActionClick}>
          {inputValue.trim().length > 0 ? (
            <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
          ) : (
            <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="К видео-аватару" />
          )}
        </button>
      </div>
    </>
  );
};

export default TextView;
