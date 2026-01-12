import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation(); // Хук для отслеживания текущего пути

  // --- СОСТОЯНИЕ ИДЕНТИФИКАЦИИ RestAI ---
  // Добавляем только эти стейты для работы ИИ, остальное не трогаем
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' });
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Эффект генерации ID при старте
  useEffect(() => {
    let uuid = localStorage.getItem('restai_guest_uuid');
    if (!uuid) {
      uuid = crypto.randomUUID();
      localStorage.setItem('restai_guest_uuid', uuid);
    }
    const fingerprintData = {
      ua: navigator.userAgent,
      res: `${window.screen.width}x${window.screen.height}`,
      lang: navigator.language
    };
    const fingerprintHash = btoa(JSON.stringify(fingerprintData)).slice(0, 32);
    setGuestInfo({ uuid, fingerprint: fingerprintHash });
  }, []);

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart'); 
    return savedCart ? JSON.parse(savedCart) : {}; 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); 
  const [viewHistory, setViewHistory] = useState([]); 
  const [chatContext, setChatContext] = useState(''); 

  // Сохранение данных в localStorage
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ (ВЕРНУЛ К ИЗНАЧАЛЬНОМУ СОСТОЯНИЮ) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; 
    // ВЕРНУЛ ТВОЮ ЛОГИКУ: Блокировка срабатывает только так, как было у тебя
    if (isMainPage || isChatOpen) {
      document.body.style.overflow = 'hidden'; 
      document.body.style.position = 'fixed'; 
      document.body.style.width = '100%'; 
      document.body.style.height = '100%'; 
      document.body.style.touchAction = 'none'; 
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = '';
    }
  }, [isChatOpen, location.pathname]);

  // --- ОБРАБОТЧИКИ ---

  // Новая функция открытия чата (с генерацией динамической сессии)
  const handleOpenChat = (dish, currentSection) => {
    if (dish) {
      const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
      setChatContext(info); 
    } else if (currentSection) {
      setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
    } else {
      setChatContext('Общее меню ресторана');
    }

    // Генерируем новый ID сессии, чтобы n8n "забывал" старое блюдо при новом открытии
    const newSession = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    setCurrentSessionId(newSession);
    setIsChatOpen(true);
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
          element={<MainScreen onChatModeToggle={(mode) => mode === 'chat' && handleOpenChat()} isChatOpen={isChatOpen} />} 
        />
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} 
              updateCart={updateCart} 
              confirmedOrders={confirmedOrders}
              onConfirmOrder={handleConfirmOrder}
              onOpenChat={handleOpenChat}
              trackDishView={trackDishView} 
            />
          } 
        />
      </Routes>

      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={() => {
          setIsChatOpen(false); 
          setChatContext('');   
        }} 
        viewHistory={viewHistory}
        pageContext={chatContext} 
        guestUuid={guestInfo.uuid}
        guestFingerprint={guestInfo.fingerprint}
        sessionId={currentSessionId}
      />
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
