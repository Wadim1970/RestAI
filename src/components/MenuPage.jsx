// src/components/MenuPage.jsx
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import styles from './MenuPage.module.css';

// Импорт дочерних компонентов страницы
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal';

// Компонент иконки "галочка" для выбранных блюд
const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

export default function MenuPage({ 
    cart = {}, 
    updateCart, 
    confirmedOrders = [], 
    onConfirmOrder,
    onOpenChat,
    trackDishView,
    onRequestBill
}) {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeSection, setActiveSection] = useState('');
    
    // 🆕 НОВОЕ: Управление видимыми секциями
    const [visibleSectionsCount, setVisibleSectionsCount] = useState(2); // Показываем первые 2 секции
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const [selectedDishForModal, setSelectedDishForModal] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);

    const sectionRefs = useRef({});
    const isScrollingRef = useRef(false);
    const loadMoreTriggerRef = useRef(null); // 🆕 Ref для триггера подгрузки

    // Загрузка меню из Supabase
    // Загрузка меню из Supabase
// Загрузка меню из Supabase
useEffect(() => {
    async function fetchMenu() {
        try {
            const { data: menuItems, error } = await supabase
                .from('menu_items')
                .select('id, dish_name, menu_section, section_order, cost_rub, image_url, image_url_thumbnail')
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
    // IntersectionObserver для активной секции
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
    }, [loading, groupedMenu, visibleSectionsCount]); // 🆕 Добавили visibleSectionsCount

    // 🆕 IntersectionObserver для подгрузки следующих секций
    useEffect(() => {
        if (loading || Object.keys(groupedMenu).length === 0) return;

        const sections = Object.keys(groupedMenu);
        
        // Если все секции уже видны — не создаём observer
        if (visibleSectionsCount >= sections.length) {
            return;
        }

        const options = {
            root: null,
            rootMargin: '200px', // Подгружаем за 200px до конца
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !isLoadingMore) {
                    console.log('🔄 Подгружаем следующую секцию...');
                    setIsLoadingMore(true);
                    
                    // Добавляем ещё одну секцию с небольшой задержкой
                    setTimeout(() => {
                        setVisibleSectionsCount(prev => Math.min(prev + 1, sections.length));
                        setIsLoadingMore(false);
                    }, 300);
                }
            });
        }, options);

        if (loadMoreTriggerRef.current) {
            observer.observe(loadMoreTriggerRef.current);
        }

        return () => observer.disconnect();
    }, [loading, groupedMenu, visibleSectionsCount, isLoadingMore]);

    const handleSectionClick = (sectionName) => {
        isScrollingRef.current = true;
        setActiveSection(sectionName); 
        
        // 🆕 Если кликнули на секцию, которая ещё не загружена — показываем её
        const sections = Object.keys(groupedMenu);
        const sectionIndex = sections.indexOf(sectionName);
        if (sectionIndex >= visibleSectionsCount) {
            setVisibleSectionsCount(sectionIndex + 1);
        }
        
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
    const visibleSections = sections.slice(0, visibleSectionsCount); // 🆕 Только видимые секции
    const isOrderActive = Object.keys(cart).length > 0 || confirmedOrders.length > 0;

    const handleOpenModal = async (dish) => {
    trackDishView(dish.dish_name);
    
    // 🆕 Если у блюда нет полных данных — загружаем их
    if (!dish.description || !dish.ingredients) {
        try {
            const { data: fullDish, error } = await supabase
                .from('menu_items')
                .select('*')
                .eq('id', dish.id)
                .single();
            
            if (error) throw error;
            
            setSelectedDishForModal(fullDish);
        } catch (err) {
            console.error('Ошибка загрузки полных данных блюда:', err);
            setSelectedDishForModal(dish); // Показываем хоть что-то
        }
    } else {
        setSelectedDishForModal(dish);
    }
    
    setIsModalOpen(true);
};

    const toggleDishSelection = (e, dishId) => {
        e.stopPropagation();
        const currentCount = cart[dishId] || 0;
        if (currentCount > 0) {
            updateCart(-currentCount, dishId);
        } else {
            updateCart(1, dishId);
        }
    };

    if (loading) return <div className={styles.loader}>Загрузка...</div>;

    return (
        <>
            {/* Хедер показывает ВСЕ секции, но прокрутка подгружает их по мере необходимости */}
            <MenuHeader 
                sections={sections} 
                activeSection={activeSection} 
                onSectionClick={handleSectionClick} 
            />

            <main className={styles.menuContainer}> 
                <div className={styles.menuContent}>
                    {/* 🆕 Рендерим только видимые секции */}
                    {visibleSections.map(sectionName => (
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
                                            {dish.image_url && (
                                                <img 
                                                    src={dish.image_url_thumbnail || dish.image_url} 
                                                    alt={dish.dish_name} 
                                                    className={styles.dishImage} 
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            )}
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
                    
                    {/* 🆕 Триггер для подгр��зки следующих секций */}
                    {visibleSectionsCount < sections.length && (
                        <div ref={loadMoreTriggerRef} className={styles.loadMoreTrigger}>
                            {isLoadingMore && <div className={styles.loadingIndicator}>Загрузка...</div>}
                        </div>
                    )}
                </div>
            </main>

            <MenuFooter 
                orderActive={isOrderActive} 
                onChatClick={() => onOpenChat(null, activeSection)} 
                onOrderClick={() => setIsCartOpen(true)}
                onCallClick={() => console.log("вызов официанта")}
            />

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
                onRequestBill={onRequestBill}
            />
        </>
    );
}
