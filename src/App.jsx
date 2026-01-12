import React, { useState, useEffect, useCallback } from 'react'; 
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal'; 

function AppContent() {
  const location = useLocation();
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' });
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState('');
  const [viewHistory, setViewHistory] = useState([]);

  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem('restaurant_cart');
    return saved ? JSON.parse(saved) : {};
  });

  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const saved = localStorage.getItem('restaurant_orders');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    let uuid = localStorage.getItem('restai_guest_uuid') || crypto.randomUUID();
    localStorage.setItem('restai_guest_uuid', uuid);
    setGuestInfo({ uuid, fingerprint: btoa(navigator.userAgent).slice(0, 16) });
  }, []);

  useEffect(() => localStorage.setItem('restaurant_cart', JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders)), [confirmedOrders]);

  // ФИКС ЦИКЛА: Обернули функцию в useCallback
  const handleOpenChat = useCallback((dish, section) => {
    if (dish) {
      setChatContext(`Блюдо: ${dish.dish_name}. Состав: ${dish.ingredients}`);
    } else if (section) {
      setChatContext(`Раздел: ${section}`);
    } else {
      setChatContext('Общее меню');
    }
    setCurrentSessionId(`sess_${Date.now()}`);
    setIsChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setIsChatOpen(false);
    setChatContext('');
  }, []);

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<MainScreen onChatModeToggle={() => handleOpenChat()} isChatOpen={isChatOpen} />} />
        <Route path="/menu" element={
          <MenuPage 
            cart={cart} 
            updateCart={(id, d) => setCart(prev => {
                const val = (prev[id] || 0) + d;
                if (val <= 0) { const { [id]: _, ...r } = prev; return r; }
                return { ...prev, [id]: val };
            })} 
            confirmedOrders={confirmedOrders}
            onOpenChat={handleOpenChat}
            trackDishView={(name) => setViewHistory(prev => [...prev, name].slice(-10))}
          />
        } />
      </Routes>

      <AIChatModal 
        isOpen={isChatOpen} 
        onClose={handleCloseChat} 
        pageContext={chatContext}
        guestUuid={guestInfo.uuid}
        guestFingerprint={guestInfo.fingerprint}
        sessionId={currentSessionId}
      />
    </div>
  );
}

function App() { return <HashRouter><AppContent /></HashRouter>; }
export default App;
