// src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainScreen from './components/MainScreen'; // Наш главный экран
import MenuPage from './components/MenuPage'; // Новая страница меню

function App() {
  return (
    <div className="App">
      {/* BrowserRouter оборачивает все приложение для управления маршрутами */}
      <BrowserRouter>
        <Routes>
          {/* Маршрут для главной страницы (аватар) */}
          <Route path="/" element={<MainScreen />} />
          {/* Маршрут для страницы меню */}
          <Route path="/menu" element={<MenuPage />} />
          {/* Можно добавить 404 страницу, но пока не будем усложнять */}
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
