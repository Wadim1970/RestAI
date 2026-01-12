import React, { useState, useEffect } from 'react'; // Подключаем ядро React и хуки состояния/эффектов
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; // Подключаем роутинг для навигации
import MainScreen from './components/MainScreen'; // Импортируем компонент главного экрана (заставки)
import MenuPage from './components/MenuPage'; // Импортируем компонент страницы меню
import AIChatModal from './components/AIChatModal/AIChatModal'; // Импортируем модалку чата с ИИ

function AppContent() {
  const location = useLocation(); // Создаем объект для отслеживания текущего URL/пути

  // --- БЛОК ИДЕНТИФИКАЦИИ RestAI ---
  // Создаем состояние для хранения постоянных данных гостя (ID и отпечаток)
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' });
  // Создаем состояние для ID текущей беседы (обнуляется при каждом открытии чата)
  const [currentSessionId, setCurrentSessionId] = useState('');

  // Эффект, который срабатывает один раз при загрузке сайта
  useEffect(() => {
    // Ищем в памяти браузера уже существующий ID гостя
    let uuid = localStorage.getItem('restai_guest_uuid');
    if (!uuid) {
      // Если его нет (первый вход) — генерируем новый случайный UUID
      uuid = crypto.randomUUID();
      // Сохраняем его, чтобы при следующем входе узнать этого же юзера
      localStorage.setItem('restai_guest_uuid', uuid);
    }
    // Собираем данные браузера для создания цифрового "отпечатка" (защита от чистки куки)
    const fingerprintHash = btoa(navigator.userAgent).slice(0, 16);
    // Записываем UUID и отпечаток в состояние приложения
    setGuestInfo({ uuid, fingerprint: fingerprintHash });
  }, []); // Пустой массив значит: выполнить только 1 раз при старте

  // --- БЛОК КОРЗИНЫ ---
  // Инициализируем корзину данными из памяти браузера или пустым объектом
  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem('restaurant_cart'); 
    return saved ? JSON.parse(saved) : {}; 
  });

  // --- БЛОК ЗАКАЗОВ ---
  // Инициализируем список заказов историей из памяти или пустым массивом
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const saved = localStorage.getItem('restaurant_orders');
    return saved ? JSON.parse(saved) : []; 
  });

  // --- БЛОК ЧАТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Состояние: открыто окно чата или закрыто
  const [viewHistory, setViewHistory] = useState([]); // Массив последних просмотренных блюд (для контекста ИИ)
  const [chatContext, setChatContext] = useState(''); // Строка с описанием того, что сейчас видит юзер

  // Эффект для автоматического сохранения корзины при любом её изменении
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
  }, [cart]);

  // Эффект для автоматического сохранения истории заказов
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders));
  }, [confirmedOrders]);

  // --- ОБРАБОТЧИКИ СОБЫТИЙ ---

  // Функция для открытия чата (принимает данные о блюде или разделе меню)
  const handleOpenChat = (dish, currentSection) => {
    if (dish) {
      // Если чат открыт из карточки — запоминаем данные этого блюда
      setChatContext(`Блюдо: ${dish.dish_name}. Описание: ${dish.description}`); 
    } else if (currentSection) {
      // Если просто из раздела — запоминаем название раздела
      setChatContext(`Раздел меню: ${currentSection}`);
    } else {
      // Если открыто кнопкой "помощь" — ставим общий контекст
      setChatContext('Общее меню');
    }
    
    // Генерируем новый ID сессии на основе времени (чтобы n8n видел новый диалог)
    const newSession = `sess_${Date.now()}`;
    setCurrentSessionId(newSession);
    // Меняем состояние на "открыто", что покажет модалку
    setIsChatOpen(true);
  };

  // Функция для обновления количества блюд в корзине
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      // Считаем новое количество (не даем уйти в минус)
      const newCount = Math.max(0, (prev[dishId] || 0) + delta);
      // Если количество 0 — удаляем блюдо из объекта корзины
      if (newCount === 0) { 
        const { [dishId]: _, ...rest } = prev; 
        return rest; 
      }
      // Иначе обновляем значение для конкретного ID блюда
      return { ...prev, [dishId]: newCount };
    });
  };

  return (
    <div className="App"> {/* Главный контейнер приложения */}
      <Routes> {/* Контейнер для переключения страниц */}
        {/* Маршрут для главной страницы (твоя заставка с видео) */}
        <Route 
          path="/" 
          element={
            <MainScreen 
              // Прокидываем функцию открытия чата (она должна вызываться в MainScreen)
              onChatModeToggle={(mode) => mode === 'chat' && handleOpenChat()} 
              isChatOpen={isChatOpen} 
            />
          } 
        />
        {/* Маршрут для страницы меню */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} // Передаем состояние корзины
              updateCart={updateCart} // Передаем функцию изменения корзины
              confirmedOrders={confirmedOrders} // Передаем историю заказов
              onOpenChat={handleOpenChat} // Передаем функцию открытия чата
            />
          } 
        />
      </Routes>

      {/* Компонент чата (рендерится всегда, но показывается по условию isOpen) */}
      <AIChatModal 
        isOpen={isChatOpen} // Передаем статус (открыт/закрыт)
        onClose={() => setIsChatOpen(false)} // Функция для закрытия крестиком
        pageContext={chatContext} // Передаем информацию о блюде для ИИ
        guestUuid={guestInfo.uuid} // Передаем постоянный ID гостя для n8n
        guestFingerprint={guestInfo.fingerprint} // Передаем отпечаток браузера для n8n
        sessionId={currentSessionId} // Передаем ID текущей сессии для n8n
      />
    </div>
  );
}

// Главная обертка приложения с HashRouter для корректной работы PWA
function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App; // Экспортируем компонент для запуска в index.js
