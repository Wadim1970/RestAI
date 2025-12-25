// src/App.jsx
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainScreen from './components/MainScreen';
import MenuPage from './components/MenuPage';

function App() {
  // Главное состояние корзины: { dishId: количество }
  const [cart, setCart] = useState({});

  // Функция добавления/изменения количества
  const updateCart = (dishId, delta) => {
    setCart(prevCart => {
      const currentCount = prevCart[dishId] || 0;
      const newCount = Math.max(0, currentCount + delta);
      
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prevCart;
        return rest;
      }
      return { ...prevCart, [dishId]: newCount };
    });
  };

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainScreen />} />
          <Route 
            path="/menu" 
            element={<MenuPage cart={cart} updateCart={updateCart} />} 
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
