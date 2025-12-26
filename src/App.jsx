// src/App.jsx
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainScreen from './components/MainScreen'; // Твой главный экран
import MenuPage from './components/MenuPage'; // Твоя страница меню

function App() {
  // 1. Текущий выбор (то, что с галочками и счетчиками прямо сейчас)
  const [cart, setCart] = useState({}); 

  // 2. Уже заказанные блюда (то, что ушло на кухню после нажатия кнопки)
  const [confirmedOrders, setConfirmedOrders] = useState([]);

  // Функция обновления текущей корзины
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

  // Функция переноса блюд из корзины в "подтвержденные" (на кухню)
  const handleConfirmOrder = (cartItems) => {
    // Сохраняем то, что заказали, в историю
    setConfirmedOrders(prev => [...prev, ...cartItems]);
    // Обнуляем текущую корзину (это автоматически снимет галочки в меню)
    setCart({});
  };

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          {/* Твой начальный экран */}
          <Route path="/" element={<MainScreen />} />
          
          {/* Страница меню с передачей всех нужных данных */}
          <Route 
            path="/menu" 
            element={
              <MenuPage 
                cart={cart} 
                updateCart={updateCart} 
                confirmedOrders={confirmedOrders}
                onConfirmOrder={handleConfirmOrder}
              />
            } 
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
