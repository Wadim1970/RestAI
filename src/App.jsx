// src/App.jsx
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function App() {
  const [cart, setCart] = useState({}); 
  const [confirmedOrders, setConfirmedOrders] = useState([]);

  // --- ЛОГИКА ДЛЯ ЧАТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); 
  const [viewHistory, setViewHistory] = useState([]); 

  // НОВОЕ: Функция, которая реагирует на тумблер (onToggle)
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
      <BrowserRouter>
        <Routes>
          {/* ИЗМЕНЕНО: Передаем функцию переключения в MainScreen */}
          <Route 
            path="/" 
            element={
              <MainScreen onChatModeToggle={handleToggleChatMode} />
            } 
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
      </BrowserRouter>

      {/* МОДАЛЬНОЕ ОКНО ЧАТА */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
        onModeToggle={handleToggleChatMode} // Передаем тумблер и внутрь чата
      />
    </div>
  );
}

export default App;
