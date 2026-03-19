import React, { useState, useEffect } from 'react'; 
import { HashRouter, Routes, Route } from 'react-router-dom'; 
import MainScreen from './components/MainScreen'; 
import MenuPage from './components/MenuPage'; 
import AIChatModal from './components/AIChatModal/AIChatModal';
import { BrandingProvider } from './context/BrandingContext';
import { ThemeProvider } from './components/ThemeProvider';
import { useBrandingConfig } from './hooks/useBrandingConfig';
import { supabase } from './supabaseClient';

 // Получаем ID ресторана из URL параметров или localStorage
 function AppContent() {
  const [restaurantId, setRestaurantId] = useState(null);
  const [tableNumber, setTableNumber] = useState(null); // 1. Добавляем стейт для номера столика

  // Получаем ID ресторана и номер столика из URL параметров или localStorage
  useEffect(() => {
    // 2. Читаем параметры после знака "?"
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('restaurant_id');
    const tableFromUrl = params.get('table'); // Ищем параметр &table=9
    
    if (idFromUrl) {
      setRestaurantId(idFromUrl);
      localStorage.setItem('restaurant_id', idFromUrl);
      
      // 3. Если в ссылке есть номер стола, тоже сохраняем его
      if (tableFromUrl) {
        setTableNumber(tableFromUrl);
        localStorage.setItem('table_number', tableFromUrl);
      }
    } else {
      // 4. Если зашли без параметров (например, обновили страницу), берем из памяти
      const savedId = localStorage.getItem('restaurant_id');
      const savedTable = localStorage.getItem('table_number');
      
      if (savedId) {
        setRestaurantId(savedId);
        if (savedTable) {
          setTableNumber(savedTable);
        }
      } else {
        // ⭐ Дефолтный ресторан на случай прямых заходов (без QR)
        const defaultId = 'dd89773c-0952-4fd1-9510-514094a928ee'; // Ваш реальный ID
        setRestaurantId(defaultId);
        localStorage.setItem('restaurant_id', defaultId);
        // Номер стола не задаем, так как это прямой заход не из-за столика
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

    // ========================================================
  // --- ФОНОВАЯ ИДЕНТИФИКАЦИЯ И РЕГИСТРАЦИЯ ГОСТЯ ---
  // ========================================================
  const [guestId, setGuestId] = useState(null); // Здесь будет храниться порядковый номер гостя (id из БД)

  useEffect(() => {
    const initializeGuest = async () => {
      // 1. Проверяем или генерируем device_id
      let deviceId = localStorage.getItem('restai_device_id');
      
      if (!deviceId) {
        deviceId = crypto.randomUUID(); // Генерируем уникальный ID силами браузера
        localStorage.setItem('restai_device_id', deviceId);
      }

      try {
        // 2. Ищем гостя в базе данных по device_id
        const { data: existingGuest, error: searchError } = await supabase
          .from('guests')
          .select('id, visit_count')
          .eq('device_id', deviceId)
          .maybeSingle(); // Используем maybeSingle вместо single, чтобы не кидало ошибку, если гостя нет

        if (existingGuest) {
          // 3А. ГОСТЬ НАЙДЕН: Обновляем счетчик визитов и дату
          await supabase
            .from('guests')
            .update({ 
              visit_count: existingGuest.visit_count + 1,
              last_visit_at: new Date().toISOString() 
            })
            .eq('id', existingGuest.id);
            
          setGuestId(existingGuest.id); // Сохраняем ID гостя в стейт
          console.log(`С возвращением! Гость №${existingGuest.id}, визит: ${existingGuest.visit_count + 1}`);

        } else {
          // 3Б. ГОСТЬ НОВЫЙ: Создаем запись в таблице
          // visit_count (1) и даты проставятся базой автоматически согласно вашей схеме SQL
          const { data: newGuest, error: insertError } = await supabase
            .from('guests')
            .insert([{ device_id: deviceId }]) 
            .select('id')
            .single();

          if (newGuest) {
            setGuestId(newGuest.id);
            console.log(`Создан новый гость №${newGuest.id}`);
          }
          if (insertError) console.error("Ошибка создания гостя:", insertError);
        }
      } catch (err) {
        console.error("Системная ошибка при инициализации гостя:", err);
      }
    };

    initializeGuest();
  }, []); // Отработает 1 раз при старте приложения
  // ========================================================
  
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
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    const savedSession = localStorage.getItem('ai_chat_session');
    return savedSession || '';
  });

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

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('ai_chat_session', currentSessionId);
    } else {
      localStorage.removeItem('ai_chat_session');
    }
  }, [currentSessionId]);

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

    // 1. ДОБАВИЛИ ВТОРОЙ АРГУМЕНТ comment
    const handleConfirmOrder = async (cartItems, comment = '') => {
    const totalAmount = cartItems.reduce((sum, item) => sum + (item.cost_rub * item.count), 0);

    const itemsToSave = cartItems.map(item => ({
      dish_id: item.id,
      name: item.dish_name,
      price: item.cost_rub,
      count: item.count
    }));

    // --- ДОБАВЛЯЕМ ВОТ ЭТОТ БЛОК ---
    let sessionToSave = currentSessionId;
    if (!sessionToSave) {
      sessionToSave = `sess_${Date.now()}`; // Генерируем ID
      setCurrentSessionId(sessionToSave); // Запоминаем для будущих чатов и дозаказов
    }
    // ------------------------------

    try {
      const { error } = await supabase
        .from('orders')
        .insert([{
          guest_id: guestId, 
          restaurant_id: restaurantId || 'default', 
          restaurant_name: branding?.name || 'Ресторан',
          session_id: sessionToSave, // Используем гарантированный ID
          items: itemsToSave,
          total_amount: totalAmount,
          comment: comment 
        }]);

      if (error) {
        console.error("Ошибка записи заказа в БД:", error);
        alert("Произошла ошибка при отправке заказа. Позовите, пожалуйста, официанта.");
        return; 
      }

      console.log('✅ Заказ успешно отправлен на кухню (в БД)!');
      setConfirmedOrders(prev => [...prev, ...cartItems]);
      setCart({}); 
      
    } catch (err) {
      console.error("Системная ошибка при оформлении:", err);
    }
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
