// ... (весь твой импорт остается прежним)

const AIChatModal = ({ isOpen, onClose, pageContext, guestUuid, guestFingerprint, sessionId }) => {
  // ... (весь твой стейт и useEffect-ы остаются без изменений)

  // --- ВОТ ЭТА ПРАВКА КРИТИЧНА: ---
  // Если модалка закрыта, возвращаем null, чтобы она физически исчезла из DOM
  // и не перекрывала невидимым слоем кнопки в MenuPage
  if (!isOpen) return null;

  return (
    <div className={`${styles.modalOverlay} ${styles.active}`} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>×</button>
        <div className={styles.messagesContainer}>
          {messages.map((msg, index) => (
            <div key={index} className={msg.role === 'user' ? styles.userMsg : styles.botMsg}>
              {msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className={styles.inputArea}>
          <textarea
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={handleInputFocus}
            placeholder="Спросите ИИ о блюдах или составе..."
          />
          <button onClick={handleSend} disabled={isLoading}>
            {isLoading ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatModal;
