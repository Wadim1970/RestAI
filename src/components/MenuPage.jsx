import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт компонентов
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal'; // Проверь путь! Если создал папку, добавь /CartModal/CartModal

const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

export default function MenuPage({ cart = {}, updateCart, confirmedOrders = [], onConfirmOrder }) {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState(''); 

    // Модалки
    const [selectedDishForModal, setSelectedDishForModal] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);

    const sectionRefs = useRef({}); 

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
            } catch (err) {
                console.error('Ошибка Supabase:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchMenu();
    }, []);

    // БЕЗОПАСНЫЙ СБОР ДАННЫХ ДЛЯ КОРЗИНЫ
    // Мы создаем массив только если данные загружены и cart не пустой
    const cartItems = [];
    if (!loading && groupedMenu) {
        Object.values(groupedMenu).flat().forEach(dish => {
            if (cart[dish.id]) {
                cartItems.push({ ...dish, count: cart[dish.id] });
            }
        });
    }

    const sections = Object.keys(groupedMenu || {}); 
    const isOrderActive = Object.keys(cart).length > 0 || confirmedOrders.length > 0;

    const handleOpenModal = (dish) => {
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
    
    const handleSectionClick = (sectionName) => {
        setActiveSection(sectionName); 
        const element = sectionRefs.current[sectionName];
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

            <MenuFooter 
                orderActive={isOrderActive} 
                onChatClick={() => console.log("чат")}
                onOrderClick={() => setIsCartOpen(true)}
                onCallClick={() => console.log("официант")}
            />

            <DishModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCart}
            />

            <CartModal 
                isOpen={isCartOpen}
                onClose={() => setIsCartOpen(false)}
                cartItems={cartItems}
                confirmedOrders={confirmedOrders}
                updateCart={updateCart}
                onConfirmOrder={onConfirmOrder}
            />
        </>
    );
}
