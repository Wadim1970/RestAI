import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './components/ThemeProvider';
import { useBrandingConfig } from './hooks/useBrandingConfig';

function AppContent() {
  const [restaurantId, setRestaurantId] = useState(null);

  // Получаем ID ресторана из URL параметров или localStorage
  useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const idFromUrl = params.get('restaurant_id');
  
  if (idFromUrl) {
    setRestaurantId(idFromUrl);
    localStorage.setItem('restaurant_id', idFromUrl);
  } else {
    const savedId = localStorage.getItem('restaurant_id');
    if (savedId) {
      setRestaurantId(savedId);
    } else {
      // ⭐ Используй ID своего ресторана из таблицы
      const defaultId = 'dd89773c-0952-4fd1-9510-514094a928ee'; // Измени на реальный ID
      setRestaurantId(defaultId);
      localStorage.setItem('restaurant_id', defaultId);
    }
  }
}, []);

  // Загружаем брендинг для текущего ресторана
  const { branding, loading: brandingLoading } = useBrandingConfig(restaurantId);
useEffect(() => {
  console.log('🔍 branding объект:', branding);
  console.log('🔍 branding.font_url_header:', branding?.font_url_header);
  console.log('🔍 branding.font_url_body:', branding?.font_url_body);
  console.log('🔍 restaurantId:', restaurantId);
  console.log('🔍 brandingLoading:', brandingLoading);
}, [branding, restaurantId, brandingLoading]);
  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart');
    if (!savedCart) return {};
    const parsed = JSON.parse(savedCart);
     // Filter out any invalid (null, NaN, or non-positive) entries left by previous bugs
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'number' && v > 0)
    ); 
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders');
    return savedOrders ? JSON.parse(savedOrders) : []; 
  });

  // --- СОСТОЯНИЕ ИСТОРИИ ЧАТА ---
  const [chatMessages, setChatMessages] = useState(() => {
    const savedChat = localStorage.getItem('chat_history');
    return savedChat ? JSON.parse(savedChat) : [];
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState([]);
  const [chatContext, setChatContext] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Эффект: сохранение корзины
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект: сохранение истории заказов
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // Эффект: сохранение чата
  useEffect(() => {
    localStorage.setItem('chat_history', JSON.stringify(chatMessages));
  }, [chatMessages]);

  // Функция отслеживания просмотров
  const trackDishView = (dishName) => {
    setViewHistory(prev => [...prev, dishName]);
  };

  const handleToggleChatMode = (newMode) => {
    // Логика переключения режима чата, если нужна
  };

  const updateCart = (delta, dishId) => {
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
    setChatMessages([]);
  };
const handleRequestBill = () => {
    // Очищаем локальные состояния
    setCart({});
    setConfirmedOrders([]);
    setChatMessages([]);
    setCurrentSessionId(''); 

    // Очищаем localStorage
    localStorage.removeItem('restaurant_cart');
    localStorage.removeItem('restaurant_orders');
    localStorage.removeItem('chat_history');
    localStorage.removeItem('ai_chat_session'); 

    alert('Счет запрошен! Скоро официант подойдет к вам.');
  };
  return (
    <BrandingProvider branding={branding} loading={brandingLoading}>
      <ThemeProvider>
        <Routes>
          <Route 
            path="/" 
            element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
          />
          <Route 
            path="/menu" 
            element={
              <MenuPage 
                cart={cart} 
                updateCart={updateCart} 
                confirmedOrders={confirmedOrders}
                onConfirmOrder={handleConfirmOrder}
                onRequestBill={handleRequestBill} 
                onOpenChat={(dish, currentSection) => {
                  // Генерируем сессию ТОЛЬКО если ее еще нет
                  if (!currentSessionId) {
                      setCurrentSessionId(`sess_${Date.now()}`); 
                  }
                  
                  if (dish) {
                    const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
                    setChatContext(info); 
                  } else if (currentSection) {
                    setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
                  } else {
                    setChatContext('Общее меню ресторана');
                  }
                  setIsChatOpen(true);
                }}
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
          sessionId={currentSessionId}
          messages={chatMessages}
          setMessages={setChatMessages}
        />
      </ThemeProvider>
    </BrandingProvider>
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
