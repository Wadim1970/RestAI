import React, { useState, useEffect } from 'react'; // Подключаем ядро React и хуки для управления состоянием и жизненным циклом
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; // Подключаем роутинг для навигации без перезагрузки страниц
import MainScreen from './components/MainScreen'; // Компонент главного экрана (видео-заставка)
import MenuPage from './components/MenuPage'; // Компонент страницы меню с блюдами
// Импортируем наш новый "мозг" системы — контроллер, который умеет показывать и чат, и видео-аватара
import AIControlCenter from './components/AIControlCenter/AIControlCenter'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути (например, '/' или '/menu')

  // --- ЛОГИКА ХРАНИЛИЩА (localStorage) ---

  // Инициализация корзины: пытаемся прочитать сохраненные данные из памяти браузера при первой загрузке
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart');
    return savedCart ? JSON.parse(savedCart) : {}; // Если данных нет, создаем пустой объект
  });

  // Инициализация истории заказов: сохраняем то, что гость уже отправил на кухню
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; // Если пусто, создаем пустой массив
  });

  // НОВОЕ СОСТОЯНИЕ: Теперь это объект, который управляет и открытием окна, и тем, что внутри (текст или видео)
  const [aiConfig, setAiConfig] = useState({
    isOpen: false, // Закрыто ли окно ИИ по умолчанию
    mode: 'text'   // Режим по умолчанию — текстовый чат
  });

  const [viewHistory, setViewHistory] = useState([]); // Массив для хранения последних просмотренных блюд (контекст для ИИ)

  // Эффект: при любом изменении корзины автоматически записываем её в localStorage (в виде строки JSON)
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: при любом изменении списка заказов дублируем его в память браузера
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УМНЫЙ ЗАМОК: Блокировка прокрутки и системных жестов (свайп вниз для обновления на Android) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; // Проверяем, на главной мы странице или нет
    
    // Блокируем скролл, если мы на главной ИЛИ если открыто любое из окон ИИ (текст или видео)
    if (isMainPage || aiConfig.isOpen) {
      document.body.style.overflow = 'hidden'; // Убираем полосу прокрутки
      document.body.style.position = 'fixed'; // Фиксируем положение экрана
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      document.body.style.top = '0';
      document.body.style.left = '0';
      document.body.style.touchAction = 'none'; // Запрещаем жесты (чтобы видео на фоне не прыгало)
    } else {
      // Если мы в меню и чат закрыт — возвращаем стандартный скролл для списка блюд
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.touchAction = '';
    }
  }, [aiConfig.isOpen, location.pathname]); // Следим за состоянием окна ИИ и текущим адресом страницы

  // Универсальная функция открытия ИИ-центра: принимает режим ('text' или 'video')
  const handleAiToggle = (mode = 'text') => {
    setAiConfig({ isOpen: true, mode: mode }); // Открываем модалку в нужном нам режиме
  };

  // Функция для записи истории: запоминаем название блюда, которое открыл пользователь
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; // Если открыли то же самое — не добавляем повторно
      return [...prev, dishName].slice(-10); // Оставляем только последние 10 записей для бота
    });
  };

  // Функция управления количеством товара в корзине (добавление/удаление)
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta); // Не даем количеству стать меньше нуля
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prev; // Если 0 — полностью удаляем товар из объекта
        return rest;
      }
      return { ...prev, [dishId]: newCount }; // Обновляем количество товара
    });
  };

  // Функция подтверждения заказа: переносит содержимое корзины в историю заказов (чек)
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); // Очищаем корзину для следующего выбора
  };

  // Функция полной очистки: сброс всего при закрытии счета или уходе гостя
  const handleClearSession = () => {
    setCart({});
    setConfirmedOrders([]);
    localStorage.removeItem('restaurant_cart');
    localStorage.removeItem('restaurant_orders');
  };

  return (
    <div className="App">
      {/* Контейнер для маршрутов страниц */}
      <Routes>
        {/* Главная страница: передаем флаг isOpen, чтобы видео на фоне знало, когда встать на паузу */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleAiToggle} isChatOpen={aiConfig.isOpen} />} 
        />
        
        {/* Страница меню со всеми пропсами для корзины и истории */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              // При нажатии на чат в меню — открываем текстовый режим по умолчанию
              onOpenChat={() => handleAiToggle('text')}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* НОВЫЙ ЕДИНЫЙ КОНТРОЛЛЕР ИИ (вместо старой модалки чата) */}
      <AIControlCenter 
        isOpen={aiConfig.isOpen} // Передаем статус (открыто/закрыто)
        mode={aiConfig.mode}     // Передаем текущий режим (текст/видео)
        // Функция закрытия: меняем только флаг isOpen, сохраняя текущий режим
        onClose={() => setAiConfig(prev => ({ ...prev, isOpen: false }))}
        // Функция переключения режима внутри модалки (из текста в видео и обратно)
        onModeChange={(newMode) => setAiConfig(prev => ({ ...prev, mode: newMode }))}
        viewHistory={viewHistory} // Передаем историю просмотров блюд для контекста ИИ
      />
    </div>
  );
}

// Корневой компонент для инициализации HashRouter (нужен для корректной работы на GitHub Pages)
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App; // Экспорт приложения для index.js
