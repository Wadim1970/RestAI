import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Следим за текущим URL (главная или меню)

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    // Пытаемся достать данные из памяти браузера при первой загрузке
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; // Если есть — парсим JSON, если нет — пустой объект
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; // Если есть — массив заказов, если нет — пустой массив
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И ИСТОРИИ ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Флаг: открыто окно чата или нет
  const [viewHistory, setViewHistory] = useState([]); // Массив строк с названиями блюд, которые смотрел юзер

  // Эффект: сохраняем корзину в localStorage каждый раз, когда она меняется
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохраняем заказы в localStorage каждый раз, когда они подтверждаются
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ И ЖЕСТАМИ ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; // Проверка: мы на главной?
    
    // МЕЛОЧЬ №1: Я упростил условия блокировки. Теперь, если чат открыт — скролл выключен ВЕЗДЕ.
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      document.body.style.position = 'fixed'; // Фиксируем, чтобы iOS не дергала экран
      document.body.style.width = '100%'; 
      document.body.style.height = '100%'; 
      document.body.style.touchAction = 'none'; // МЕЛОЧЬ №2: Отключаем pull-to-refresh (свайп вниз для обновления)
    } else {
      // Если мы в меню и чат закрыт — возвращаем стандартное поведение браузера
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]); // Срабатывает при смене страницы или открытии чата

  // --- ОБРАБОТЧИКИ ---

  // МЕЛОЧЬ №3: Логика открытия чата. 
  // Я убрал «else { setIsChatOpen(false) }», чтобы случайный вызов функции с другим параметром не закрыл модалку.
  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') {
      setIsChatOpen(true);
    }
  };

  // МЕЛОЧЬ №4: Я ВЕРНУЛ ЭТУ ФУНКЦИЮ. 
  // В прошлом твоем коде её не было, а MenuPage её требовал. Это и вызывало белый экран (ReferenceError).
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; // Не дублируем одно и то же блюдо подряд
      return [...prev, dishName].slice(-10); // Оставляем только 10 последних просмотров для экономии памяти
    });
  };

  // Обновление количества товара
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta); // Не уходим в минус
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prev; // Удаляем товар из объекта, если его стало 0
        return rest;
      }
      return { ...prev, [dishId]: newCount };
    });
  };

  // Перенос из корзины в историю чека
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); // Чистим корзину
  };

  return (
    <div className="App">
      <Routes>
        {/* Главный экран: передаем функцию открытия чата и статус (открыт/закрыт) */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
        />
        {/* Страница меню: передаем всё для работы корзины и трекинга блюд */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={() => setIsChatOpen(true)}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* МЕЛОЧЬ №5: Я убрал отсюда пропс onModeToggle={handleToggleChatMode}.
         Почему? Потому что модалка теперь сама переключает режимы «текст/видео» внутри себя.
         Ей больше не нужно сообщать об этом в App.js. Это делает код чище и быстрее.
      */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
      />
    </div>
  );
}

// Стартовая точка приложения
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
