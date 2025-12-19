import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './MenuPage.module.css';

// Импорт новых компонентов
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 

// --- НАСТРОЙКИ SUPERBASE ---
const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83'; // Используйте публичный ключ!
const supabase = createClient(supabaseUrl, supabaseAnonKey);


// Временная заглушка для иконки
const Checkmark = () => <div className={styles.checkmarkIcon}></div>;

export default function MenuPage() {
    const [groupedMenu, setGroupedMenu] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedDishes, setSelectedDishes] = useState({}); 
    const [activeSection, setActiveSection] = useState('Популярное'); 

    // 1. REF ДЛЯ ОТСЛЕЖИВАНИЯ СЕКЦИЙ И ПРОКРУТКИ
    const sectionRefs = useRef({}); 
    
    // 2. ДОБАВЛЯЕМ этот НОВЫЙ Ref (для контейнера прокрутки <main>):
    const mainContainerRef = useRef(null);
    useEffect(() => {
        async function fetchMenu() {
    const { data: menuItems, error } = await supabase
        .from('menu_items')
        .select('*')
        // ИЗМЕНЯЕМ СОРТИРОВКУ ТУТ:
        // Сначала по вашей новой колонке (от меньшего к большему)
        .order('section_order', { ascending: true }) 
        // Дополнительно можно отсортировать блюда по алфавиту внутри самого раздела
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

    // Логика
    // 2. ВОССТАНАВЛИВАЕМ ОБЫЧНЫЙ СПИСОК РАЗДЕЛОВ (без CUSTOM_SECTION_ORDER)
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
    
    // 3. ДОРАБОТАННЫЙ handleSectionClick: ПРОКРУТКА К РАЗДЕЛУ (Пункт 3)
    const handleSectionClick = (sectionName) => {
        // Устанавливаем секцию активной
        setActiveSection(sectionName); 
        
        // Плавная прокрутка к элементу
        const element = sectionRefs.current[sectionName];
        if (element) {
            element.scrollIntoView({ 
                behavior: 'smooth', 
                // Выводим элемент примерно на середину видимой области
                block: 'start' 
            });
        }
    };
    
    const handleChatClick = () => console.log("Переход в Чат");
    const handleOrderClick = () => console.log("Переход в Корзину");
    const handleCallClick = () => console.log("Вызов официанта");


    // 4. ЛОГИКА СИНХРОНИЗАЦИИ СКРОЛЛА И ХЕДЕРА (Observer)
    // Эта логика срабатывает, только если мы прокручиваем вручную, 
    // не мешая клику на хедере.
    useEffect(() => {
    // Если данные еще грузятся — выходим
    if (loading || sections.length === 0) return;

    const observerOptions = {
        // ВАЖНО: root: null означает, что мы следим за скроллом ВСЕГО ОКНА браузера.
        // Это именно то, что нам нужно после перехода на естественный скролл.
        root: null, 
        
        // rootMargin создает "линию срабатывания". 
        // -120px сверху — это сразу под твоим фиксированным хедером.
        // -70% снизу — чтобы активной считалась только верхняя видимая секция.
        rootMargin: '-120px 0px -70% 0px',
        threshold: 0
    };

    const observerCallback = (entries) => {
        entries.forEach(entry => {
            // Если секция пересекла нашу невидимую "линию под хедером"
            if (entry.isIntersecting) {
                const sectionName = entry.target.getAttribute('data-section');
                if (sectionName) {
                    setActiveSection(sectionName);
                }
            }
        });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    // Начинаем следить за каждой секцией
    sections.forEach(sectionName => {
        const element = sectionRefs.current[sectionName];
        if (element) {
            observer.observe(element);
        }
    });

    return () => observer.disconnect();
}, [sections, loading]); // Убрали зависимость от mainContainerRef
    
            {/* --- 1. HEADER (Фиксированный) --- */}
            <MenuHeader 
                sections={sections} 
                activeSection={activeSection} 
                onSectionClick={handleSectionClick} // Используем доработанный обработчик
            />

            {/* --- 2. ОСНОВНОЙ КОНТЕНТ МЕНЮ (Прокручиваемый) --- */}
            <main className={styles.menuContainer} ref={mainContainerRef}> 
                
                <div className={styles.menuContent}>
                    {sections.map(sectionName => (
                        <section 
                            key={sectionName} 
                            className={styles.menuSection} 
                            id={sectionName.toLowerCase().replace(/\s/g, '-')}
                            
                            // 5. ПРИВЯЗКА REF И DATA-АтрибуТА
                            ref={el => sectionRefs.current[sectionName] = el}
                            data-section={sectionName}
                        >
                            <h2>{sectionName}</h2>
                            
                            <div className={styles.dishGrid}>
                                {groupedMenu[sectionName] && groupedMenu[sectionName].map(dish => (
                                    <div key={dish.id} className={styles.dishCard}>
                                        
                                        {/* Контейнер изображения и интерактивных элементов */}
                                        <div className={styles.dishImageContainer}>
                                            
                                            {/* Изображение */}
                                            {dish.image_url && <img src={dish.image_url} alt={dish.dish_name} className={styles.dishImage} />}
                                            
                                            {/* Поле с ценой */}
                                            <div className={styles.priceTag}>
                                                <p className={styles.dishPrice}>{dish.cost_rub} ₽</p>
                                            </div>

                                            {/* Интерактивное окно выбора блюда */}
                                            <button 
                                                className={`${styles.selectButton} ${selectedDishes[dish.id] ? styles.selected : ''}`}
                                                onClick={() => toggleDishSelection(dish.id)}
                                            >
                                                {selectedDishes[dish.id] && <Checkmark />}
                                            </button>

                                        </div>

                                        {/* Название блюда */}
                                        <p className={styles.dishName}>{dish.dish_name}</p>

                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </main>

            {/* --- 3. FOOTER (Фиксированный) --- */}
            <MenuFooter 
                orderActive={isOrderActive} 
                onChatClick={handleChatClick}
                onOrderClick={handleOrderClick}
                onCallClick={handleCallClick}
            />
        </>
    );
}
