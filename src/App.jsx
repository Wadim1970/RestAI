import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation();
  const [cart, setCart] = useState({}); 
  const [confirmedOrders, setConfirmedOrders] = useState([]);
  const [isChatOpen, setIsChatOpen] = useState(false); 
  const [viewHistory, setViewHistory] = useState([]); 

  // --- УМНЫЙ ЗАМОК: Блокирует сдвиг только на главной ---
  useEffect(() => {
    const isMainPage = location.pathname === '/';
    // Если мы на главной ИЛИ открыт чат — фиксируем экран, чтобы видео не прыгало
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      document.body.style.top = '0';
      document.body.style.left = '0';
      document.body.style.touchAction = 'none'; // Запрет лишних жестов
    } else {
      // В МЕНЮ всё сбрасываем в ноль, чтобы работал обычный скролл списка блюд
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') {
      setIsChatOpen(true);
    } else {
      setIsChatOpen(false);
    }
  };

  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev;
      return [...prev, dishName].slice(-10);
    });
  };

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

  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    setCart({});
  };

  return (
    <div className="App">
      <Routes>
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} />} 
        />
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

      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
        onModeToggle={handleToggleChatMode} 
      />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
