import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути в приложении

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    // Загружаем корзину из памяти браузера при старте
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    // Загружаем уже подтвержденные заказы (историю чека)
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Открыт ли чат
  const [viewHistory, setViewHistory] = useState([]); // История просмотров (список блюд)
  const [chatContext, setChatContext] = useState(''); // НОВОЕ: Храним инфу о блюде, из которого открыли чат

  // Эффект: сохранение корзины при каждом изменении
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ И ЖЕСТАМИ ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; 
    // Если мы на главной или открыт чат — блокируем системный скролл (для мобилок)
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      document.body.style.position = 'fixed'; 
      document.body.style.width = '100%'; 
      document.body.style.height = '100%'; 
      document.body.style.touchAction = 'none'; 
    } else {
      // Иначе возвращаем стандартный скролл
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // --- ОБРАБОТЧИКИ ---

  // Переключение режима чата
  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') {
      setIsChatOpen(true);
    }
  };

  // Трекинг просмотров блюд (чтобы знать, что юзер листал)
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; 
      return [...prev, dishName].slice(-10); 
    });
  };

  // Изменение количества товара в корзине (+1 или -1)
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

  // Подтверждение заказа (перенос из корзины в историю)
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({}); 
  };

  return (
    <div className="App">
      <Routes>
        {/* Роут главной страницы */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
        />
        {/* Роут страницы меню */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              // ОБНОВЛЕНО: теперь функция принимает dish и сохраняет его данные для чата
              onOpenChat={(dish) => {
                if (dish) {
                  const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
                  setChatContext(info); // Кладём данные о блюде в стейт
                } else {
                  setChatContext('Общее меню');
                }
                setIsChatOpen(true); // Открываем чат
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
          setChatContext('');   // Очищаем контекст, чтобы при следующем открытии не было старых данных
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} // ОТПРАВЛЯЕМ КОНТЕКСТ: Теперь данные о борще долетят до n8n
      />
    </div>
  );
}

// Входная точка с HashRouter для корректной работы на Vercel/GitHub Pages
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
