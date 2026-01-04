import React, { useState, useEffect } from 'react'; // Подключаем React и стандартные хуки (состояние и побочные эффекты)
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; // Подключаем роутинг: хэш-роутер, контейнеры путей и хук определения текущего адреса
import MainScreen from './components/MainScreen'; // Импортируем компонент главного экрана с аватаром
import MenuPage from './components/MenuPage'; // Импортируем компонент страницы меню
import AIChatModal from './components/AIChatModal/AIChatModal'; // Импортируем модальное окно чата с ИИ

function AppContent() {
  const location = useLocation(); // Инициализируем хук, который следит за тем, на какой странице (URL) находится пользователь

  // --- ЛОГИКА ХРАНИЛИЩА (localStorage) ---

  // 1. Создаем состояние корзины. В скобках функция, которая один раз при загрузке берет данные из памяти браузера
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart'); // Пробуем достать строку с корзиной из localStorage
    return savedCart ? JSON.parse(savedCart) : {}; // Если нашли — превращаем строку в объект, если нет — создаем пустую корзину {}
  });

  // 2. Создаем состояние уже подтвержденных заказов (история чека)
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders'); // Пробуем достать историю заказов
    return savedOrders ? JSON.parse(savedOrders) : []; // Если нашли — преобразуем в массив, иначе создаем пустой массив []
  });

  const [isChatOpen, setIsChatOpen] = useState(false); // Состояние: открыто ли сейчас модальное окно чата (true/false)
  const [viewHistory, setViewHistory] = useState([]); // Состояние: список последних просмотренных блюд для контекста бота

  // Эффект автоматического сохранения: срабатывает при каждом изменении объекта cart
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart)); // Превращаем объект корзины в строку и кладем в память браузера
  }, [cart]); // Зависимость [cart] означает "запускай это, когда корзина изменилась"

  // Эффект автоматического сохранения заказов: срабатывает при каждом подтверждении блюд
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders)); // Сохраняем массив заказов в память
  }, [confirmedOrders]); // Зависимость [confirmedOrders]

  // --- УМНЫЙ ЗАМОК: Блокировка системного скролла и жестов перезагрузки ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; // Проверяем, находится ли пользователь на главной странице
    // Если пользователь на главной ИЛИ у него открыт чат — блокируем всё лишнее
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; // Запрещаем прокрутку страницы
      document.body.style.position = 'fixed'; // Фиксируем экран, чтобы он не дергался
      document.body.style.width = '100%'; // Растягиваем фиксацию на всю ширину
      document.body.style.height = '100%'; // Растягиваем фиксацию на всю высоту
      document.body.style.top = '0'; // Прижимаем к верху
      document.body.style.left = '0'; // Прижимаем к левому краю
      document.body.style.touchAction = 'none'; // Отключаем все системные жесты (включая свайп-перезагрузку Android)
    } else {
      // Если мы перешли в меню — сбрасываем все стили, чтобы пользователь мог свободно скроллить список блюд
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]); // Перезапускаем логику при открытии чата или смене страницы

  // Функция переключения режима чата. Вызывается из MainScreen или модалки
 const handleToggleChatMode = (mode) => {
    // Если пришел сигнал 'chat' — только тогда открываем.
    // Мы убираем автоматическое закрытие (setIsChatOpen(false)), 
    // чтобы другие режимы не захлопывали окно.
    if (mode === 'chat') {
      setIsChatOpen(true);
    }
  };

  // Функция обновления количества товара в корзине
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0; // Берем текущее количество или 0
      const newCount = Math.max(0, currentCount + delta); // Считаем новое, но не даем уйти в минус
      if (newCount === 0) {
        const { [dishId]: _, ...rest } = prev; // Если 0 — удаляем этот ключ из объекта корзины
        return rest;
      }
      return { ...prev, [dishId]: newCount }; // Возвращаем обновленный объект корзины
    });
  };

  // Функция переноса товаров из корзины в историю заказов
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]); // Объединяем старые заказы с новыми из корзины
    setCart({}); // Полностью очищаем корзину после заказа
  };

  // Функция полной очистки данных пользователя (вызывается при "закрытии счета")
  const handleClearSession = () => {
    setCart({}); // Чистим стейт корзины
    setConfirmedOrders([]); // Чистим стейт заказов
    localStorage.removeItem('restaurant_cart'); // Удаляем корзину из памяти браузера
    localStorage.removeItem('restaurant_orders'); // Удаляем заказы из памяти браузера
  };

  return (
    <div className="App">
      {/* Контейнер для маршрутов */}
      <Routes>
        {/* Главная страница: теперь мы передаем параметр isChatOpen, чтобы MainScreen знал, когда ставить видео на паузу */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
        />
        
        {/* Страница Меню: передаем все функции управления корзиной и историей */}
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

      {/* Модальное окно чата: рендерится всегда "поверх", но показывается только если isOpen={true} */}
      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        viewHistory={viewHistory}
        onModeToggle={handleToggleChatMode} 
      />
    </div>
  );
}

// Корневой компонент приложения
function App() {
  return (
    // Оборачиваем всё в HashRouter для корректной работы ссылок на GitHub Pages (без 404 при обновлении)
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App; // Экспортируем приложение
