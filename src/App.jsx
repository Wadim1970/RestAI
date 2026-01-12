import React, { useState, useEffect } from 'react'; // Импорт библиотеки React и хуков состояния и эффектов
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'; // Импорт инструментов для навигации (роутинга)
import MainScreen from './components/MainScreen'; // Импорт компонента заставки (главного экрана)
import MenuPage from './components/MenuPage'; // Импорт компонента страницы со списком блюд
import AIChatModal from './components/AIChatModal/AIChatModal'; // Импорт компонента модального окна чата

function AppContent() {
  const location = useLocation(); // Инициализация хука для получения текущего пути в адресной строке

  // --- НОВОЕ: СОСТОЯНИЕ ИДЕНТИФИКАЦИИ ДЛЯ ИИ (RestAI) ---
  const [guestInfo, setGuestInfo] = useState({ uuid: '', fingerprint: '' }); // Создание стейта для хранения ID гостя и отпечатка браузера
  const [currentSessionId, setCurrentSessionId] = useState(''); // Создание стейта для ID текущей сессии переписки в чате

  // Эффект для создания уникального ID гостя при первом входе (не влияет на UI)
  useEffect(() => {
    let uuid = localStorage.getItem('restai_guest_uuid'); // Пытаемся получить сохраненный UUID из памяти браузера
    if (!uuid) { // Если UUID еще не существует (первый визит)
      uuid = crypto.randomUUID(); // Генерируем новый случайный уникальный идентификатор
      localStorage.setItem('restai_guest_uuid', uuid); // Сохраняем сгенерированный UUID в память браузера
    }
    const fp = btoa(navigator.userAgent).slice(0, 16); // Создаем краткий "цифровой отпечаток" на основе данных о браузере
    setGuestInfo({ uuid, fingerprint: fp }); // Сохраняем UUID и отпечаток в состояние приложения
  }, []); // Пустой массив зависимостей означает, что код выполнится один раз при старте приложения

  // --- СОСТОЯНИЕ КОРЗИНЫ ---
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('restaurant_cart'); // Пытаемся достать данные корзины из памяти браузера
    return savedCart ? JSON.parse(savedCart) : {}; // Если данные есть — парсим их, если нет — создаем пустой объект
  });

  // --- СОСТОЯНИЕ ЗАКАЗОВ ---
  const [confirmedOrders, setConfirmedOrders] = useState(() => {
    const savedOrders = localStorage.getItem('restaurant_orders'); // Пытаемся достать историю заказов из памяти
    return savedOrders ? JSON.parse(savedOrders) : []; // Если заказов нет — возвращаем пустой массив
  });

  // --- СОСТОЯНИЕ МОДАЛКИ И КОНТЕКСТА ---
  const [isChatOpen, setIsChatOpen] = useState(false); // Стейт управления видимостью окна чата (true/false)
  const [viewHistory, setViewHistory] = useState([]); // Стейт для хранения массива имен просмотренных пользователем блюд
  const [chatContext, setChatContext] = useState(''); // Стейт для хранения текстового описания текущего контекста для ИИ

  // Эффект: сохранение корзины в память браузера при каждом её изменении (добавлении/удалении блюд)
  useEffect(() => {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart)); // Превращаем объект корзины в строку и кладем в localStorage
  }, [cart]); // Следим за изменениями переменной cart

  // Эффект: сохранение истории заказов в память браузера при подтверждении заказа
  useEffect(() => {
    localStorage.setItem('restaurant_orders', JSON.stringify(confirmedOrders)); // Превращаем массив заказов в строку и кладем в localStorage
  }, [confirmedOrders]); // Следим за изменениями переменной confirmedOrders

  // --- УПРАВЛЕНИЕ СКРОЛЛОМ И ЖЕСТАМИ (ТВОЙ ОРИГИНАЛЬНЫЙ КОД) ---
  useEffect(() => {
    const isMainPage = location.pathname === '/'; // Проверяем, находится ли пользователь на корневой странице
    if (isMainPage || isChatOpen) { // Если мы на главной ИЛИ открыто окно чата
      document.body.style.overflow = 'hidden'; // Запрещаем прокрутку страницы
      document.body.style.position = 'fixed'; // Фиксируем тело страницы, чтобы избежать скачков
      document.body.style.width = '100%'; // Устанавливаем ширину на 100% для корректной фиксации
      document.body.style.height = '100%'; // Устанавливаем высоту на 100%
      document.body.style.touchAction = 'none'; // Отключаем жесты прокрутки пальцем (важно для мобильных)
    } else {
      document.body.style.overflow = ''; // Возвращаем стандартную прокрутку (для меню)
      document.body.style.position = ''; // Снимаем фиксацию тела страницы
      document.body.style.width = ''; // Снимаем ограничение по ширине
      document.body.style.height = ''; // Снимаем ограничение по высоте
      document.body.style.touchAction = ''; // Включаем жесты обратно
    }
  }, [isChatOpen, location.pathname]); // Срабатывает при смене страницы или открытии/закрытии чата

  // --- ОБРАБОТЧИКИ ---

  // Функция переключения режима чата из главного экрана
  const handleToggleChatMode = (mode) => {
    if (mode === 'chat') { // Если получен сигнал активации чата
      const newSession = `sess_${Date.now()}`; // Генерируем уникальный ID сессии на основе времени
      setCurrentSessionId(newSession); // Записываем ID сессии в состояние
      setIsChatOpen(true); // Меняем стейт на "открыто"
    }
  };

  // Запись истории просмотров (храним только последние 10 позиций)
  const trackDishView = (dishName) => {
    setViewHistory(prev => {
      if (prev[prev.length - 1] === dishName) return prev; // Если текущее блюдо совпадает с последним — ничего не делаем
      return [...prev, dishName].slice(-10); // Добавляем новое имя в массив и обрезаем до 10 последних
    });
  };

  // Изменение количества товара в корзине (добавление или удаление)
  const updateCart = (dishId, delta) => {
    setCart(prev => {
      const currentCount = prev[dishId] || 0; // Получаем текущее количество или 0, если товара нет
      const newCount = Math.max(0, currentCount + delta); // Считаем новое количество (не ниже нуля)
      if (newCount === 0) { // Если количество стало 0
        const { [dishId]: _, ...rest } = prev; // Удаляем это блюдо из объекта корзины
        return rest; // Возвращаем корзину без этого блюда
      }
      return { ...prev, [dishId]: newCount }; // Иначе возвращаем корзину с обновленным количеством
    });
  };

  // Подтверждение заказа (очистка корзины и запись в историю)
  const handleConfirmOrder = (cartItems) => {
    setConfirmedOrders(prev => [...prev, ...cartItems]); // Добавляем заказанные позиции в массив истории
    setCart({}); // Полностью очищаем объект текущей корзины
  };

  return (
    <div className="App"> {/* Основной контейнер приложения */}
      <Routes> {/* Обертка для определения маршрутов */}
        {/* Главная страница (заставка) */}
        <Route 
          path="/" 
          element={<MainScreen onChatModeToggle={handleToggleChatMode} isChatOpen={isChatOpen} />} 
        />
        {/* Страница основного меню */}
        <Route 
          path="/menu" 
          element={
            <MenuPage 
              cart={cart} // Передача стейта корзины
              updateCart={updateCart} // Передача функции изменения корзины
              confirmedOrders={confirmedOrders} // Передача истории заказов
              onConfirmOrder={handleConfirmOrder} // Передача функции подтверждения заказа
              onOpenChat={(dish, currentSection) => { // Обработчик открытия чата из меню
                if (dish) {
                  // Если открыто из блюда — формируем строку с подробностями
                  const info = `Блюдо: ${dish.dish_name}. Описание: ${dish.description}. Состав: ${dish.ingredients}`;
                  setChatContext(info); 
                } else if (currentSection) {
                  // Если открыто из раздела — передаем название раздела
                  setChatContext(`Пользователь сейчас просматривает раздел меню: "${currentSection}"`);
                } else {
                  setChatContext('Общее меню ресторана'); // Заглушка по умолчанию
                }
                const newSession = `sess_${Date.now()}`; // Генерируем ID сессии при каждом открытии окна чата
                setCurrentSessionId(newSession); // Сохраняем ID сессии
                setIsChatOpen(true); // Показываем модалку чата
              }}
              trackDishView={trackDishView} // Передача функции трекинга просмотров
            />
          } 
        />
      </Routes>

      {/* Модальное окно чата с ИИ */}
      <AIChatModal 
        isOpen={isChatOpen} // Передаем состояние видимости
        onClose={() => {
          setIsChatOpen(false); // Функция закрытия: меняем стейт на false
          setChatContext(''); // Очищаем текст контекста при закрытии
        }} 
        viewHistory={viewHistory} // Передаем историю просмотров для ИИ
        pageContext={chatContext} // Передаем сформированный текст контекста для ИИ
        guestUuid={guestInfo.uuid} // Передаем постоянный ID гостя для n8n
        guestFingerprint={guestInfo.fingerprint} // Передаем отпечаток устройства для n8n
        sessionId={currentSessionId} // Передаем ID сессии для n8n
      />
    </div>
  );
}

// Корневой компонент приложения
function App() {
  return (
    <HashRouter> {/* Использование хеш-роутера для стабильной работы путей в PWA */}
      <AppContent /> {/* Отрисовка основного контента приложения */}
    </HashRouter>
  );
}

export default App; // Экспорт компонента для подключения в index.js
