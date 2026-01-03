import React, { useState } from 'react'; // Подключаем React и хук для управления текстом в поле
import { useNavigate } from 'react-router-dom'; // Хук для навигации между страницами (нужен для перехода в меню)
import styles from './AIChatModal.module.css'; // Импортируем изолированные стили модуля

const AIChatModal = ({ isOpen, onClose, viewHistory }) => {
  // inputValue хранит то, что пользователь печатает в поле ввода
  const [inputValue, setInputValue] = useState(''); 
  const navigate = useNavigate(); // Инициализируем навигацию

  // Если пропс isOpen равен false, компонент ничего не отрисовывает (модалка скрыта)
  if (!isOpen) return null; 

  // Функция, которая вызывается при нажатии на круглую зеленую кнопку справа
  const handleAction = () => {
    // Проверяем: если в поле введено хотя бы одно слово (не считая пробелов)
    if (inputValue.trim().length > 0) {
      // Здесь будет логика отправки сообщения боту
      console.log("Сообщение отправлено:", inputValue);
      // Очищаем поле после отправки (иконка в кнопке сама сменится обратно на аудио)
      setInputValue(''); 
    } else {
      // Если поле пустое, кнопка работает как "Назад" и закрывает чат, возвращая видео
      onClose();
    }
  };

  return (
    // modal-overlay: затемнение и блокировка основного экрана
    <div className={styles['modal-overlay']}>
      
      {/* modal-glassContainer: эффект матового стекла на весь экран */}
      <div className={styles['modal-glassContainer']}>
        
        {/* modal-chatHistory: область, где бегут сообщения чата */}
        <div className={styles['modal-chatHistory']}>
          <div className={styles['modal-botMessage']}>Вам помочь с выбором?</div>
          
          {/* Если есть история просмотров (контекст), выводим её мелким шрифтом для справки */}
          {viewHistory && viewHistory.length > 0 && (
            <div style={{fontSize: '10px', opacity: 0.5, marginTop: '10px'}}>
              Контекст: {viewHistory.join(', ')}
            </div>
          )}
        </div>

        {/* modal-footerControls: контейнер для поля ввода и кнопки (отступы 12px от краев) */}
        <div className={styles['modal-footerControls']}>
          
          {/* modal-inputWrapper: обертка текстового поля с белым фоном и радиусами */}
          <div className={styles['modal-inputWrapper']}>
            
            {/* Иконка меню внутри поля слева */}
            <img 
              src="/icons/free-icon-main-menu-2.png" 
              className={styles['modal-menuInInput']} 
              alt="Меню"
              onClick={() => navigate('/menu')} // При клике закрываем чат и уходим на страницу меню
            />
            
            {/* Само поле ввода текста */}
            <textarea 
              className={styles['modal-textArea']}
              placeholder="Вам помочь с выбором?"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)} // Обновляем состояние при каждом нажатии клавиши
              autoFocus // Автоматически ставим курсор в поле при открытии
            />
          </div>

          {/* modal-actionButton: круглая зеленая кнопка (58px) */}
          <button className={styles['modal-actionButton']} onClick={handleAction}>
            {/* УСЛОВИЕ: Если текст есть — рисуем стрелку, если нет — микрофон */}
            {inputValue.trim().length > 0 ? (
              <img src="/icons/free-icon-start.png" className={styles['modal-iconSend']} alt="Отправить" />
            ) : (
              <img src="/icons/free-icon-audio.png" className={styles['modal-iconAudio']} alt="Голос" />
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AIChatModal;
