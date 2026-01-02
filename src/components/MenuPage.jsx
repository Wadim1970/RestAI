// src/components/MenuPage.jsx
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт компонентов
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal';

const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

// ДОБАВИЛИ: Принимаем onOpenChat и trackDishView из пропсов
export default function MenuPage({ 
    cart = {}, 
    updateCart, 
    confirmedOrders = [], 
    onConfirmOrder,
    onOpenChat,      // Функция открытия чата
    trackDishView    // Функция записи истории просмотров
}) {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState(''); 

    // Модалки
    const [selectedDishForModal, setSelectedDishForModal] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);

    const sectionRefs = useRef({}); 
    const isScrollingRef = useRef(false);

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
                const grouped = items.reduce((acc, item) => {
                    const section = item.menu_section;
                    if (!acc[section]) acc[section] = [];
                    acc[section].push(item);
                    return acc;
                }, {});
                setGroupedMenu(grouped);
                
                const firstSection = Object.keys(grouped)[0];
                if (firstSection) setActiveSection(firstSection);

            } catch (err) {
                console.error('Ошибка Supabase:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchMenu();
    }, []);

    useEffect(() => {
        if (loading || Object.keys(groupedMenu).length === 0) return;

        const options = {
            root: null,
            rootMargin: '-160px 0px -70% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            if (isScrollingRef.current) return;
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setActiveSection(entry.target.getAttribute('data-section'));
                }
            });
        }, options);

        const sectionsElements = document.querySelectorAll(`section.${styles.menuSection}`);
        sectionsElements.forEach((section) => observer.observe(section));

        return () => observer.disconnect();
    }, [loading, groupedMenu]);

    const handleSectionClick = (sectionName) => {
        isScrollingRef.current = true;
        setActiveSection(sectionName); 
        
        const element = sectionRefs.current[sectionName];
        if (element) {
            const yOffset = -150;
            const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({ top: y, behavior: 'smooth' });
            setTimeout(() => { isScrollingRef.current = false; }, 1000);
        }
    };

    const cartItems = groupedMenu && Object.keys(groupedMenu).length > 0 
    ? Object.values(groupedMenu).flat().filter(dish => cart && cart[dish.id]).map(dish => ({
        ...dish,
        count: cart[dish.id]
      }))
    : [];

    const sections = Object.keys(groupedMenu || {}); 
    const isOrderActive = Object.keys(cart).length > 0 || confirmedOrders.length > 0;

    // ОБНОВЛЕНО: Теперь при открытии модалки записываем просмотр для ИИ
    const handleOpenModal = (dish) => {
        trackDishView(dish.dish_name); // Запоминаем, что пользователь смотрел это блюдо
        setSelectedDishForModal(dish);
        setIsModalOpen(true);
    };

    const toggleDishSelection = (e, dishId) => {
        e.stopPropagation();
        const currentCount = cart[dishId] || 0;
        if (currentCount > 0) {
            updateCart(dishId, -currentCount); 
        } else {
            updateCart(dishId, 1);
        }
    };

    if (loading) return <div className={styles.loader}>Загрузка...</div>;

    return (
        <>
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
                            data-section={sectionName}
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

            {/* ОБНОВЛЕНО: Привязываем onChatClick к функции открытия чата */}
            <MenuFooter 
                orderActive={isOrderActive} 
                onChatClick={onOpenChat} 
                onOrderClick={() => setIsCartOpen(true)}
                onCallClick={() => console.log("официант")}
            />

            {/* ОБНОВЛЕНО: Прокидываем onOpenChat внутрь модалки блюда */}
            <DishModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCart}
                onOpenChat={onOpenChat} 
            />

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
