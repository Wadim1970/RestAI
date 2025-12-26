import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт компонентов
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal'; // <-- НОВОЕ: Импорт корзины

const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

// НОВОЕ: Принимаем cart и updateCart из App.js
export default function MenuPage({ cart, updateCart }) {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState(''); 

    // СОСТОЯНИЕ ДЛЯ МОДАЛЬНОГО ОКНА БЛЮДА
    const [selectedDishForModal, setSelectedDishForModal] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // НОВОЕ: СОСТОЯНИЕ ДЛЯ МОДАЛЬНОГО ОКНА КОРЗИНЫ
    const [isCartOpen, setIsCartOpen] = useState(false);

    const sectionRefs = useRef({}); 

    useEffect(() => {
        async function fetchMenu() {
            const { data: menuItems, error } = await supabase
                .from('menu_items')
                .select('*')
                .order('section_order', { ascending: true }) 
                .order('dish_name', { ascending: true }); 

            if (error) {
                console.error('Ошибка загрузки данных Supabase:', error);
            } else {
                const items = Array.isArray(menuItems) ? menuItems : []; 
                const grouped = items.reduce((acc, item) => {
                    const section = item.menu_section;
                    if (!acc[section]) acc[section] = [];
                    acc[section].push(item);
                    return acc;
                }, {});
                setGroupedMenu(grouped);
            }
            setLoading(false);
        }
        fetchMenu();
    }, []);

    const sections = Object.keys(groupedMenu || {}); 
    
    // НОВОЕ: Проверка, есть ли что-то в корзине для активации футера
    const isOrderActive = Object.keys(cart).length > 0;

    // НОВОЕ: Получаем массив объектов блюд, которые лежат в корзине
    const cartItems = [];
if (groupedMenu) {
    Object.values(groupedMenu).flat().forEach(dish => {
        if (cart && cart[dish.id]) {
            cartItems.push({ ...dish, count: cart[dish.id] });
        }
    });
}

    const handleOpenModal = (dish) => {
        setSelectedDishForModal(dish);
        setIsModalOpen(true);
    };

    // Обновленная функция выбора (теперь работает с глобальной корзиной)
    const toggleDishSelection = (e, dishId) => {
        e.stopPropagation();
        if (cart[dishId]) {
            updateCart(dishId, -cart[dishId]); // Удаляем всё количество
        } else {
            updateCart(dishId, 1); // Добавляем 1 шт
        }
    };
    
    const handleSectionClick = (sectionName) => {
        setActiveSection(sectionName); 
        const element = sectionRefs.current[sectionName];
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };
    
    const handleChatClick = () => console.log("Переход в Чат");
    
    // НОВОЕ: Открытие корзины
    const handleOrderClick = () => setIsCartOpen(true);
    
    const handleCallClick = () => console.log("Вызов официанта");

    useEffect(() => {
        if (loading || sections.length === 0) return;
        const observerOptions = {
            root: null,
            rootMargin: '-116px 0px -70% 0px',
            threshold: [0, 0.01, 0.1]
        };
        const observerCallback = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sectionName = entry.target.getAttribute('data-section');
                    if (sectionName) setActiveSection(sectionName);
                }
            });
        };
        const observer = new IntersectionObserver(observerCallback, observerOptions);
        const timer = setTimeout(() => {
            sections.forEach(sectionName => {
                const element = sectionRefs.current[sectionName];
                if (element) observer.observe(element);
            });
        }, 150);
        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, [sections, loading]);

    if (loading) return <div className={styles.menuContainer} style={{textAlign: 'center', paddingTop: '150px'}}>Загрузка меню...</div>;

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
                                {groupedMenu[sectionName] && groupedMenu[sectionName].map(dish => (
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

            <MenuFooter 
                orderActive={isOrderActive} 
                onChatClick={handleChatClick}
                onOrderClick={handleOrderClick}
                onCallClick={handleCallClick}
            />

            {/* МОДАЛКА БЛЮДА: Передаем count и updateCart */}
            <DishModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCart}
            />

            {/* НОВОЕ: МОДАЛКА КОРЗИНЫ */}
            <CartModal 
                isOpen={isCartOpen}
                onClose={() => setIsCartOpen(false)}
                cartItems={cartItems}
                updateCart={updateCart}
                onOrder={(comment) => console.log("Заказ отправлен:", comment)}
            />
        </>
    );
}
