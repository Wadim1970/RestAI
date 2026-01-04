import React, { useState, useEffect } from 'react';
// Импортируем HashRouter вместо BrowserRouter для стабильной работы на GitHub Pages
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Получаем текущий путь (урл)
  const [cart, setCart] = useState({}); // Состояние корзины
  const [confirmedOrders, setConfirmedOrders] = useState([]); // Состояние уже сделанных заказов
  const [isChatOpen, setIsChatOpen] = useState(false); // Открыто ли окно чата
  const [viewHistory, setViewHistory] = useState([]); // История просмотров блюд для контекста ИИ

  // --- УМНЫЙ ЗАМОК: Блокирует сдвиг только на главной ---
  useEffect(() => {
    // В HashRouter путь начинается после символа #, проверяем корень
    const isMainPage = location.pathname === '/';
    
    // Если мы на главной ИЛИ открыт чат — фиксируем экран "намертво"
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; // Запрещаем прокрутку
      document.body.style.position = 'fixed'; // Фиксируем тело страницы
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      document.body.style.top = '0';
      document.body.style.left = '0';
      document.body.style.touchAction = 'none'; // Полная блокировка системных жестов (включая обновление страницы)
    } else {
      // Когда переходим в меню, возвращаем стандартное поведение скролла
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // Функция переключения режима чата (голос или текст)
  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') {
      setIsChatOpen(true);
    } else {
      setIsChatOpen(false);
    }
  };

  // Запоминаем, какие блюда открывал пользователь
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; // Не дублируем последнее
      return [...prev, dishName].slice(-10); // Храним только последние 10 просмотров
    });
  };

  // Универсальная функция обновления количества блюд в корзине
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta);
      if (newCount === 0) {
        // Если количество стало 0 — удаляем товар из корзины совсем
        const { [dishId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dishId]: newCount }; // Обновляем количество
    });
  };

  // Функция подтверждения заказа (перенос из корзины в историю)
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); // Очищаем временную корзину
  };

  return (
    <div className="App">
      <Routes>
        {/* Главный экран */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} />} 
        />
        {/* Экран меню */}
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

      {/* Модальное окно чата (всегда "висит" в дереве, открывается по isOpen) */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
        onModeToggle={handleToggleChatMode} 
      />
    </div>
  );
}

// Главный компонент App, который оборачивает всё в Роутер
function App() {
  return (
    // ВАЖНО: Мы используем именно HashRouter, который импортировали выше
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
