// src/components/MainScreen.jsx
// src/components/MainScreen.jsx
import React, { useState, useRef } from 'react'; // Импортируем React и хуки
import { useNavigate } from 'react-router-dom'; // Импортируем навигацию для перехода в меню
import VideoBackground from './VideoBackground.jsx'; // Подключаем компонент с фоновым видео
import MenuButton from './MenuButton.jsx'; // Подключаем кнопку "Меню"
import ToggleChatButton from './ToggleChatButton.jsx'; // Подключаем кнопку переключения чата

// Основной компонент экрана, принимает функцию onChatModeToggle для открытия чата
const MainScreen = ({ onChatModeToggle }) => {
  const navigate = useNavigate(); // Создаем функцию для смены страниц (роутинга)
  const [isStarted, setIsStarted] = useState(false); // Стейт: нажал ли пользователь "Войти"

  // Функция, которая срабатывает при клике на оверлей старта
  const handleStart = () => {
    setIsStarted(true); // Устанавливаем, что приложение запущено
    const video = document.querySelector('video'); // Ищем элемент видео на странице
    if (video) {
      video.muted = false; // Включаем звук (браузеры разрешают звук только после клика)
      video.play().catch(error => { // Запускаем воспроизведение
        console.error("Ошибка автоплея:", error); // Выводим ошибку, если видео не завелсь
      });
    }
  };

  // Функция для перехода на страницу меню
  const handleOpenMenu = () => {
    navigate('/menu'); // Перенаправляем пользователя по адресу /menu
  };

  // Функция-посредник: получает сигнал от тумблера и передает его наверх в App.jsx
  const handleModeToggle = (newMode) => {
    if (onChatModeToggle) {
        onChatModeToggle(newMode); // Вызываем функцию из пропсов (передает 'chat' или 'voice')
    }
  };

  return (
    <div 
      className="main-screen-wrapper" // Главная обертка всего экрана
      style={{ 
        position: 'fixed', // Замораживаем обертку, чтобы она не двигалась
        top: 0, // Прижимаем к самому верху
        left: 0, // Прижимаем к левому краю
        width: '100vw', // Растягиваем на всю ширину экрана
        height: '100vh', // Растягиваем на всю высоту экрана
        background: '#000', // Черный фон, пока видео грузится
        overflow: 'hidden', // Запрещаем любой внутренний скролл
        zIndex: 1 // Устанавливаем базовый слой
      }}
    >

      {/* 1. Компонент видео-фона, который всегда под кнопками */}
      <VideoBackground />

      {/* 2. Оверлей (заставка): виден только если isStarted === false */}
      {!isStarted && (
        <div 
          onClick={handleStart} // Вешаем клик на весь экран для старта
          style={{
            position: 'absolute', // Абсолютное позиционирование поверх видео
            top: 0, // Растягиваем от верха
            left: 0, // Растягиваем от левого края
            width: '100%', // На всю ширину
            height: '100%', // На всю высоту
            backgroundColor: 'rgba(0,0,0,0.3)', // Затемнение видео на 30%
            display: 'flex', // Включаем флексбокс для центровки
            flexDirection: 'column', // Элементы (круг и текст) друг под другом
            justifyContent: 'center', // Центрируем по вертикали
            alignItems: 'center', // Центрируем по горизонтали
            zIndex: 100, // Слой выше видео
            cursor: 'pointer' // Меняем курсор на "руку"
          }}
        >
          {/* Зеленый круг с иконкой Play */}
          <div style={{
            width: '80px', // Ширина круга
            height: '80px', // Высота круга
            borderRadius: '50%', // Делаем круглым
            background: 'rgba(48, 77, 34, 0.9)', // Твой фирменный зеленый цвет
            display: 'flex', // Центрируем треугольник внутри
            justifyContent: 'center', // Центровка по горизонтали
            alignItems: 'center', // Центровка по вертикали
            border: '2px solid white', // Белая рамка вокруг круга
            marginBottom: '20px' // Отступ снизу до текста
          }}>
            {/* Треугольник (символ Play) через границы (border) */}
            <div style={{
              width: 0, // Ширина самого блока 0
              height: 0, // Высота самого блока 0
              borderTop: '15px solid transparent', // Прозрачная верхняя грань
              borderBottom: '15px solid transparent', // Прозрачная нижняя грань
              borderLeft: '25px solid white', // Белая левая грань создает треугольник
              marginLeft: '5px' // Смещение вправо для визуальной центровки треугольника
            }}></div>
          </div>
          
          {/* Текст под кнопкой старта */}
          <span style={{ 
            color: 'white', // Цвет текста белый
            fontFamily: 'Manrope, sans-serif', // Твой шрифт Manrope
            fontWeight: 'bold', // Жирное начертание
            fontSize: '18px', // Размер шрифта
            letterSpacing: '2px' // Расстояние между буквами
          }}>
            НАЖМИТЕ, ЧТОБЫ ВОЙТИ
          </span>
        </div>
      )}

      {/* 3. Контейнер с двумя нижними кнопками (появляется после старта) */}
      {isStarted && (
        /* ВАЖНО: Мы сменили класс на buttons-footer-fixed для жесткой привязки к координате TOP в CSS */
        <div className="buttons-footer-fixed"> 
          {/* Кнопка "Перейти в меню" */}
          <MenuButton onClick={handleOpenMenu} />
          {/* Кнопка-тумблер переключения режимов Чат/Голос */}
          <ToggleChatButton onToggle={handleModeToggle} />
        </div>
      )}
    </div>
  );
};

export default MainScreen;
