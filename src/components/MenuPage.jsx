// src/components/MenuPage.jsx
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт дочерних компонентов страницы
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal';

// Настройка подключения к базе данных Supabase
const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Компонент иконки "галочка" для выбранных блюд
const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

export default function MenuPage({ 
    cart = {}, 
    updateCart, 
    confirmedOrders = [], 
    onConfirmOrder,
    onOpenChat,      // Функция для открытия чата (приходит из App.jsx)
    trackDishView    // Функция для логирования просмотров блюд
}) {
    const [groupedMenu, setGroupedMenu] = useState({}); // Меню, разбитое по категориям
    const [loading, setLoading] = useState(true); // Состояние загрузки данных
    const [activeSection, setActiveSection] = useState(''); // Текущий активный раздел (для навигации и контекста)

    // Состояния для модальных окон
    const [selectedDishForModal, setSelectedDishForModal] = useState(null); // Выбранное блюдо для показа в модалке
    const [isModalOpen, setIsModalOpen] = useState(false); // Открыта ли модалка блюда
    const [isCartOpen, setIsCartOpen] = useState(false); // Открыта ли корзина

    const sectionRefs = useRef({}); // Ссылки на DOM-узлы каждой секции для плавного скролла
    const isScrollingRef = useRef(false); // Флаг, чтобы не менять активную секцию во время программного скролла

    // Эффект для загрузки меню из Supabase при первом рендере
    useEffect(() => {
        async function fetchMenu() {
            try {
                const { data: menuItems, error } = await supabase
                    .from('menu_items')
                    .select('*')
                    .order('section_order', { ascending: true }) 
                    .order('dish_name', { ascending: true }); 

                if (error) throw error;

                const items = Array.isArray(menuItems) ? menuItems : []; 
                // Группируем блюда по их названию раздела (menu_section)
                const grouped = items.reduce((acc, item) => {
                    const section = item.menu_section;
                    if (!acc[section]) acc[section] = [];
                    acc[section].push(item);
                    return acc;
                }, {});
                setGroupedMenu(grouped);
                
                // Устанавливаем самый первый раздел как активный по умолчанию
                const firstSection = Object.keys(grouped)[0];
                if (firstSection) setActiveSection(firstSection);

            } catch (err) {
                console.error('Ошибка Supabase:', err);
            } finally {
                setLoading(false); // Выключаем индикатор загрузки
            }
        }
        fetchMenu();
    }, []);

    // Эффект IntersectionObserver: следит за тем, какой раздел сейчас на экране
    useEffect(() => {
        if (loading || Object.keys(groupedMenu).length === 0) return;

        const options = {
            root: null, // Следим относительно всего экрана
            rootMargin: '-160px 0px -70% 0px', // Зона срабатывания (учитываем высоту хедера)
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            if (isScrollingRef.current) return; // Если мы сами крутим экран кнопкой — игнорируем
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    // Обновляем состояние активной секции (это и будет наш контекст для чата)
                    setActiveSection(entry.target.getAttribute('data-section'));
                }
            });
        }, options);

        // Находим все секции меню и подписываем наблюдателя на каждую
        const sectionsElements = document.querySelectorAll(`section.${styles.menuSection}`);
        sectionsElements.forEach((section) => observer.observe(section));

        return () => observer.disconnect(); // Очистка при размонтировании
    }, [loading, groupedMenu]);

    // Обработка клика по кнопке категории в хедере
    const handleSectionClick = (sectionName) => {
        isScrollingRef.current = true;
        setActiveSection(sectionName); 
        
        const element = sectionRefs.current[sectionName];
        if (element) {
            const yOffset = -150; // Смещение, чтобы заголовок не прятался под хедером
            const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({ top: y, behavior: 'smooth' }); // Плавная прокрутка
            setTimeout(() => { isScrollingRef.current = false; }, 1000); // Разблокируем observer после анимации
        }
    };

    // Собираем массив товаров для отображения в корзине
    const cartItems = groupedMenu && Object.keys(groupedMenu).length > 0 
    ? Object.values(groupedMenu).flat().filter(dish => cart && cart[dish.id]).map(dish => ({
        ...dish,
        count: cart[dish.id]
      }))
    : [];

    const sections = Object.keys(groupedMenu || {}); // Список всех имен секций
    const isOrderActive = Object.keys(cart).length > 0 || confirmedOrders.length > 0; // Есть ли что-то в корзине или чеке

    // Обработчик открытия подробного окна блюда
    const handleOpenModal = (dish) => {
        trackDishView(dish.dish_name); // Сохраняем имя блюда в историю просмотров для ИИ
        setSelectedDishForModal(dish); // Устанавливаем блюдо для модалки
        setIsModalOpen(true); // Открываем окно
    };

    // Добавление/удаление блюда в корзину кнопкой-галочкой на карточке
    const toggleDishSelection = (e, dishId) => {
        e.stopPropagation(); // Чтобы не открылась модалка самого блюда
        const currentCount = cart[dishId] || 0;
        if (currentCount > 0) {
            updateCart(dishId, -currentCount); // Если уже есть — удаляем полностью
        } else {
            updateCart(dishId, 1); // Если нет — добавляем 1 штуку
        }
    };

    if (loading) return <div className={styles.loader}>Загрузка...</div>;

    return (
        <>
            {/* Хедер с навигацией по категориям */}
            <MenuHeader 
                sections={sections} 
                activeSection={activeSection} 
                onSectionClick={handleSectionClick} 
            />

            <main className={styles.menuContainer}> 
                <div className={styles.menuContent}>
                    {sections.map(sectionName => (
                        <section 
                            key={sectionName} 
                            className={styles.menuSection} 
                            ref={el => sectionRefs.current[sectionName] = el}
                            data-section={sectionName} // Атрибут для отслеживания через IntersectionObserver
                        >
                            <h2>{sectionName}</h2>
                            <div className={styles.dishGrid}>
                                {groupedMenu[sectionName]?.map(dish => (
                                    <div key={dish.id} className={styles.dishCard}>
                                        <div 
                                            className={styles.dishImageContainer}
                                            onClick={() => handleOpenModal(dish)}
                                        >
                                            {dish.image_url && <img src={dish.image_url} alt={dish.dish_name} className={styles.dishImage} />}
                                            <div className={styles.priceTag}>
                                                <p className={styles.dishPrice}>{dish.cost_rub} ₽</p>
                                            </div>
                                            {/* Кнопка быстрого добавления */}
                                            <button 
                                                className={`${styles.selectButton} ${cart[dish.id] ? styles.selected : ''}`}
                                                onClick={(e) => toggleDishSelection(e, dish.id)}
                                            >
                                                {cart[dish.id] && <Checkmark />}
                                            </button>
                                        </div>
                                        <p className={styles.dishName}>{dish.dish_name}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </main>

            {/* Футер с кнопкой вызова ИИ чата */}
            <MenuFooter 
                orderActive={isOrderActive} 
                // ИЗМЕНЕНО: При клике на чат в футере передаем null (нет блюда) и activeSection (текущий раздел меню)
                onChatClick={() => onOpenChat(null, activeSection)} 
                onOrderClick={() => setIsCartOpen(true)}
                onCallClick={() => console.log("вызов официанта")}
            />

            {/* Модальное окно с деталями блюда */}
            <DishModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCart}
                // Прокидываем функцию открытия чата внутрь модалки блюда (там dish передастся автоматически)
                onOpenChat={onOpenChat} 
            />

            {/* Модальное окно корзины */}
            <CartModal 
                isOpen={isCartOpen}
                onClose={() => setIsCartOpen(false)}
                cartItems={cartItems}
                confirmedOrders={confirmedOrders || []}
                updateCart={updateCart}
                onConfirmOrder={onConfirmOrder}
            />
        </>
    );
}
