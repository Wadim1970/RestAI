import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт новых компонентов
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 

// --- НАСТРОЙКИ SUPABASE ---
const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Временная заглушка для иконки
const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

export default function MenuPage() {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedDishes, setSelectedDishes] = useState({}); 
    const [activeSection, setActiveSection] = useState(''); 

    // REF ДЛЯ ОТСЛЕЖИВАНИЯ СЕКЦИЙ
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
                    if (!acc[section]) {
                        acc[section] = [];
                    }
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
    const isOrderActive = Object.keys(selectedDishes).length > 0;

    const toggleDishSelection = (dishId) => {
        setSelectedDishes(prev => {
            const newState = { ...prev };
            if (newState[dishId]) {
                delete newState[dishId]; 
            } else {
                newState[dishId] = true;
            }
            return newState;
        });
    };
    
    const handleSectionClick = (sectionName) => {
        setActiveSection(sectionName); 
        const element = sectionRefs.current[sectionName];
        if (element) {
            element.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }
    };
    
    const handleChatClick = () => console.log("Переход в Чат");
    const handleOrderClick = () => console.log("Переход в Корзину");
    const handleCallClick = () => console.log("Вызов официанта");

    // ЛОГИКА СИНХРОНИЗАЦИИ СКРОЛЛА
    useEffect(() => {
        if (loading || sections.length === 0) return;

        const observerOptions = {
            root: null, // Следим за окном браузера
            // Чувствительная зона: -130px (под хедером) и отсекаем нижние 80% экрана
            rootMargin: '-130px 0px -80% 0px',
            threshold: 0
        };

        const observerCallback = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sectionName = entry.target.getAttribute('data-section');
                    if (sectionName) {
                        setActiveSection(sectionName);
                    }
                }
            });
        };

        const observer = new IntersectionObserver(observerCallback, observerOptions);

        // Ждем небольшую паузу, чтобы элементы успели попасть в DOM и рефы
        const timer = setTimeout(() => {
            sections.forEach(sectionName => {
                const element = sectionRefs.current[sectionName];
                if (element) {
                    observer.observe(element);
                }
            });
        }, 150);

        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, [sections, loading]);


    if (loading) {
        return <div className={styles.menuContainer} style={{textAlign: 'center', paddingTop: '150px'}}>Загрузка меню...</div>;
    }

    if (sections.length === 0 && !loading) {
        return <div className={styles.menuContainer} style={{textAlign: 'center', paddingTop: '150px', color: 'red'}}>Нет данных для отображения.</div>;
    }

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
                            id={sectionName.toLowerCase().replace(/\s/g, '-')}
                            ref={el => sectionRefs.current[sectionName] = el}
                            data-section={sectionName}
                        >
                            <h2>{sectionName}</h2>
                            
                            <div className={styles.dishGrid}>
                                {groupedMenu[sectionName] && groupedMenu[sectionName].map(dish => (
                                    <div key={dish.id} className={styles.dishCard}>
                                        <div className={styles.dishImageContainer}>
                                            {dish.image_url && <img src={dish.image_url} alt={dish.dish_name} className={styles.dishImage} />}
                                            <div className={styles.priceTag}>
                                                <p className={styles.dishPrice}>{dish.cost_rub} ₽</p>
                                            </div>
                                            <button 
                                                className={`${styles.selectButton} ${selectedDishes[dish.id] ? styles.selected : ''}`}
                                                onClick={() => toggleDishSelection(dish.id)}
                                            >
                                                {selectedDishes[dish.id] && <Checkmark />}
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
        </>
    );
}
