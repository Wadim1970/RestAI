// src/components/MenuPage.jsx
import { useState, useEffect, useRef } from 'react';
import styles from './MenuPage.module.css';

// Импорт дочерних компонентов страницы
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal';

// Вес/объём для строки под названием: «510 г», «750 мл». В данных он бывает
// в specific_details ({weight_value, weight_unit} или строка «750 мл») и в
// weight_g в виде «/ 510 г.».
function formatWeight(dish) {
    const d = dish.specific_details;
    if (d && typeof d === 'object' && d.weight_value) return `${d.weight_value} ${d.weight_unit || 'г'}`;
    if (typeof d === 'string' && d.trim()) return d.trim();
    if (dish.weight_g) return String(dish.weight_g).replace(/^[\s/]+/, '').replace(/\.$/, '').trim();
    return '';
}

const formatPrice = (rub) => `${Number(rub || 0).toLocaleString('ru-RU')} ₽`;

export default function MenuPage({
    restaurantId,
    cart = {}, 
    updateCart, 
    confirmedOrders = [], 
    onConfirmOrder,
    onOpenChat,
    trackDishView,
    onRequestBill,
    onCallWaiter,
    isCallPending = false
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
    // z-index карточки блюда: из меню — по умолчанию; открытая из корзины
    // (клик по фото) — выше самой корзины (её overlay 100000), чтобы легла
    // поверх, а не под неё.
    const [dishModalZ, setDishModalZ] = useState(undefined);

    const sectionRefs = useRef({});
    const isScrollingRef = useRef(false);
    const loadMoreTriggerRef = useRef(null); // 🆕 Ref для триггера подгрузки
    // Секция, к которой нужно доскроллить, как только она подгрузится в DOM
    // (тап по ещё не отрендеренной категории — см. handleSectionClick).
    const pendingScrollRef = useRef(null);

    // Загрузка меню из Supabase
    // Загрузка меню из Supabase
// Загрузка меню из Supabase
useEffect(() => {
    async function fetchMenu() {
        if (!restaurantId) return;
        try {
            // Идёт через /api/menu (кэшируется на Vercel Edge), а не напрямую
            // в Supabase — меню одинаково для всех гостей ресторана, незачем
            // грузить его заново при каждом заходе каждого гостя.
            const res = await fetch(`/api/menu?restaurantId=${encodeURIComponent(restaurantId)}`);
            const json = await res.json();
            if (!res.ok) {
                // Подтягиваем настоящую причину из /api/menu (code/detail/hint),
                // чтобы в консоли было видно, что именно вернул PostgREST.
                const extra = [json.code, json.detail, json.hint].filter(Boolean).join(' | ');
                throw new Error((json.error || 'Ошибка загрузки меню') + (extra ? ` — ${extra}` : ''));
            }
            const menuItems = json.items;

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
}, [restaurantId]);
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

    // Прокрутка к секции. Возвращает false, если DOM-элемента секции ещё нет
    // (значит, её надо сперва подгрузить — см. pendingScrollRef).
    const scrollToSection = (sectionName) => {
        const element = sectionRefs.current[sectionName];
        if (!element) return false;
        const yOffset = -160; // под высоту фиксированного хедера
        const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
        setTimeout(() => { isScrollingRef.current = false; }, 1000);
        return true;
    };

    const handleSectionClick = (sectionName) => {
        isScrollingRef.current = true;
        setActiveSection(sectionName);

        const sections = Object.keys(groupedMenu);
        const sectionIndex = sections.indexOf(sectionName);

        // Секция ещё не отрендерена (ленивая подгрузка показывает их по мере
        // прокрутки). Её DOM-элемента пока нет — прокрутить сразу нельзя, из-за
        // этого первый тап «не срабатывал», а доезжало только со второго.
        // Показываем секцию и запоминаем цель — доскроллим в useEffect ниже,
        // как только она появится в DOM.
        if (sectionIndex >= visibleSectionsCount) {
            pendingScrollRef.current = sectionName;
            setVisibleSectionsCount(sectionIndex + 1);
            return;
        }

        scrollToSection(sectionName);
    };

    // Доскролл к только что подгруженной секции (тап по категории, которой ещё
    // не было в DOM). Срабатывает, когда отрендерятся новые секции.
    useEffect(() => {
        const target = pendingScrollRef.current;
        if (!target || !sectionRefs.current[target]) return;
        // rAF — дать браузеру применить layout вставленных секций перед замером.
        requestAnimationFrame(() => {
            if (scrollToSection(target)) pendingScrollRef.current = null;
        });
    }, [visibleSectionsCount, groupedMenu]);

    const cartItems = groupedMenu && Object.keys(groupedMenu).length > 0 
    ? Object.values(groupedMenu).flat().filter(dish => cart && cart[dish.id]).map(dish => ({
        ...dish,
        count: cart[dish.id]
      }))
    : [];

    const sections = Object.keys(groupedMenu || {});
    const visibleSections = sections.slice(0, visibleSectionsCount); // 🆕 Только видимые секции
    const isOrderActive = Object.keys(cart).length > 0 || confirmedOrders.length > 0;
    // Счётчик и сумма на кнопке «Заказ» — только то, что ещё не отправлено.
    const cartCount = cartItems.reduce((n, d) => n + d.count, 0);
    const cartSum = cartItems.reduce((n, d) => n + d.count * (Number(d.cost_rub) || 0), 0);

    const handleOpenModal = (dish, z = undefined) => {
    trackDishView(dish.dish_name);

    // Все поля карточки (описание, состав, product_type, specific_details)
    // приходят вместе с меню через /api/menu (same-origin, кэш Vercel).
    // Раньше здесь был отдельный запрос НАПРЯМУЮ в Supabase за полными
    // данными — он падал по таймауту/CORS в сетях, где хост Supabase
    // недоступен из браузера (при этом /api работает), из-за чего на части
    // десктопов не грузились описание и состав. Больше прямых запросов нет.
    setDishModalZ(z);
    setSelectedDishForModal(dish);
    setIsModalOpen(true);
};

    // «+» / «−» на карточке: раньше была галочка «выбрано/не выбрано», теперь
    // количество меняется прямо в меню, без захода в карточку блюда.
    const changeCount = (e, dishId, delta) => {
        e.stopPropagation();
        if (delta < 0 && !(cart[dishId] > 0)) return;
        updateCart(delta, dishId);
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
                                {groupedMenu[sectionName]?.map(dish => {
                                    const count = cart[dish.id] || 0;
                                    const weight = formatWeight(dish);
                                    return (
                                    <div key={dish.id} className={styles.dishCard}>
                                        <div
                                            className={styles.dishImageContainer}
                                            onClick={() => handleOpenModal(dish)}
                                        >
                                            {dish.image_url && (
                                                <img
                                                    src={dish.image_url}
                                                    alt={dish.dish_name}
                                                    className={styles.dishImage}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            )}
                                        </div>
                                        <p className={styles.dishName} onClick={() => handleOpenModal(dish)}>{dish.dish_name}</p>
                                        <div className={styles.dishRow}>
                                            <p className={styles.dishPrice}>
                                                {formatPrice(dish.cost_rub)}
                                                {weight && <span className={styles.dishWeight}>{weight}</span>}
                                            </p>
                                            {count > 0 ? (
                                                <div className={styles.stepper}>
                                                    <button type="button" aria-label={`Убрать ${dish.dish_name}`} onClick={(e) => changeCount(e, dish.id, -1)}>−</button>
                                                    <span>{count}</span>
                                                    <button type="button" aria-label={`Добавить ещё ${dish.dish_name}`} onClick={(e) => changeCount(e, dish.id, 1)}>+</button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={styles.addButton}
                                                    aria-label={`Добавить ${dish.dish_name}`}
                                                    onClick={(e) => changeCount(e, dish.id, 1)}
                                                >+</button>
                                            )}
                                        </div>
                                    </div>
                                    );
                                })}
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
                cartCount={cartCount}
                cartSumLabel={cartCount > 0 ? formatPrice(cartSum) : null}
                onChatClick={() => onOpenChat(null, activeSection)} 
                onOrderClick={() => setIsCartOpen(true)}
                onCallClick={onCallWaiter}
                isCallPending={isCallPending}
            />

            <DishModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCart}
                onOpenChat={onOpenChat}
                overlayZIndex={dishModalZ}
            />

            <CartModal
                isOpen={isCartOpen}
                onClose={() => setIsCartOpen(false)}
                cartItems={cartItems}
                confirmedOrders={confirmedOrders || []}
                updateCart={updateCart}
                onConfirmOrder={onConfirmOrder}
                onRequestBill={onRequestBill}
                onDishClick={(item) => handleOpenModal(item, 100001)}
            />
        </>
    );
}
