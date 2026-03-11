import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal';
import { BrandingProvider } from './context/BrandingContext';
import { useBrandingConfig } from './hooks/useBrandingConfig';

function AppContent() {
  const location = useLocation();
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
      if (savedId) setRestaurantId(savedId);
    }
  }, []);

  // Загружаем брендинг для текущего ресторана
  const { branding, loading: brandingLoading } = useBrandingConfig(restaurantId);

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

  // --- СОСТОЯНИЕ ИСТОРИИ ЧАТА ---
  const [chatMessages, setChatMessages] = useState(() => {
    const savedChat = localStorage.getItem('chat_history');
    return savedChat ? JSON.parse(savedChat) : [];
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState([]);
  const [chatContext, setChatContext] = useState('');

  // --- СОСТОЯНИЕ ДЛЯ ДИНАМИЧЕСКОГО ID СЕССИИ ---
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

  // Остальной код компонента...

  return (
    <BrandingProvider branding={branding} loading={brandingLoading}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<MainScreen onChatModeToggle={(newMode) => {}} isChatOpen={isChatOpen} />} />
          <Route path="/menu" element={<MenuPage cart={cart} updateCart={setCart} confirmedOrders={confirmedOrders} onConfirmOrder={(order) => setConfirmedOrders([...confirmedOrders, order])} onOpenChat={() => setIsChatOpen(true)} trackDishView={(dishName) => setViewHistory([...viewHistory, dishName])} />} />
        </Routes>
        {isChatOpen && <AIChatModal onClose={() => setIsChatOpen(false)} chatMessages={chatMessages} setChatMessages={setChatMessages} chatContext={chatContext} currentSessionId={currentSessionId} setCurrentSessionId={setCurrentSessionId} />}
      </HashRouter>
    </BrandingProvider>
  );
};

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
