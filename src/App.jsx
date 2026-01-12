import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути (маршрута)

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    // Загружаем данные корзины из localStorage при инициализации
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    // Загружаем истории подтвержденных заказов
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Состояние: открыт ли чат с ИИ
  const [viewHistory, setViewHistory] = useState([]); // История просмотренных блюд (массив имен)
  const [chatContext, setChatContext] = useState(''); // Контекст для ИИ (данные о блюде или разделе)

  // --- НОВОЕ: СОСТОЯНИЕ ДЛЯ ДИНАМИЧЕСКОГО ID СЕССИИ ---
  const [currentSessionId, setCurrentSessionId] = useState(''); // Уникальный ID текущего диалога

  // Эффект: сохранение корзины в память браузера при каждом её изменении
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов в память браузера
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ И ЖЕСТАМИ ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; 
    // Блокируем прокрутку страницы, если мы на главной или открыт чат (для фиксации UI)
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      document.body.style.position = 'fixed'; 
      document.body.style.width = '100%'; 
      document.body.style.height = '100%'; 
      document.body.style.touchAction = 'none'; 
    } else {
      // Возвращаем стандартное поведение скролла для страницы меню
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // --- ОБРАБОТЧИКИ ---

  // Открытие чата из главного экрана (MainScreen)
  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') {
      // НОВОЕ: Генерируем уникальный ID сессии при открытии с главной
      setCurrentSessionId(`sess_${Date.now()}`); 
      setIsChatOpen(true);
    }
  };

  // Запись истории просмотров (сохраняем последние 10 уникальных просмотров)
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; 
      return [...prev, dishName].slice(-10); 
    });
  };

  // Изменение количества товара в корзине
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta); 
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prev; 
        return rest;
      }
      return { ...prev, [dishId]: newCount };
    });
  };

  // Подтверждение заказа: перенос товаров из корзины в историю и очистка корзины
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); 
  };

  return (
    <div className="App">
      <Routes>
        {/* Главная страница */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
        />
        {/* Страница меню */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={(dish, currentSection) => {
                // НОВОЕ: Генерируем уникальный ID сессии при каждом открытии чата из меню
                setCurrentSessionId(`sess_${Date.now()}`); 

                if (dish) {
                  const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
                  setChatContext(info); 
                } else if (currentSection) {
                  setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
                } else {
                  setChatContext('Общее меню ресторана');
                }
                setIsChatOpen(true); // Открываем модальное окно чата
              }}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      {/* Модальное окно чата с ИИ */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => {
          setIsChatOpen(false); // Закрываем чат
          setChatContext('');   // Очищаем контекст
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} // Передаем собранный контекст
        // НОВОЕ: Передаем сгенерированный ID сессии в модалку
        sessionId={currentSessionId} 
      />
    </div>
  );
}

// Обертка с HashRouter для корректной навигации в веб-окружениях
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
