// src/components/MenuPage.jsx
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import styles from './MenuPage.module.css';

// Импорт дочерних компонентов страницы
import MenuHeader from './MenuHeader/MenuHeader'; 
import MenuFooter from './MenuFooter/MenuFooter'; 
import DishModal from './DishModal/DishModal';
import CartModal from './CartModal/CartModal';
import PairingSheet from './PairingSheet/PairingSheet';
import { supabase } from '../supabaseClient';
import { getOrCreateDeviceId } from '../lib/deviceId';
import { formatPrice, formatWeight } from '../lib/menuFormat';
import { pickPairing, rememberShown, rememberAnswer, loadMemory, saveMemory, expandPairingsByName } from '../lib/pairingRules';

// Сервер официанта (Waiter-app): там подбор пар под конкретного гостя.
const PAIRINGS_API = (import.meta.env.VITE_PAIRINGS_API_URL || 'https://waiter.restai.pro').replace(/\/$/, '');
// Режим проверки (ссылка с &pairs=test): подсказка на каждое первое добавление,
// без лимитов «пауза 5 секунд / 3 за визит» — для проверки и показа ресторану.
const PAIRINGS_TEST_MODE = new URLSearchParams(window.location.search).get('pairs') === 'test';


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

    // Пары блюд: общие приходят с /api/menu, личные (с учётом «не ем» и вкусов
    // гостя) — с сервера официанта в фоне. null — личных нет, берём общие.
    const [pairings, setPairings] = useState({});
    const [personalPairings, setPersonalPairings] = useState(null);
    const [offer, setOffer] = useState(null);
    const [toast, setToast] = useState('');
    const pairingMemoryRef = useRef(null);
    const offerTimerRef = useRef(null);
    const toastTimerRef = useRef(null);

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
            setPairings(json.pairings && typeof json.pairings === 'object' ? json.pairings : {});

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

    // Личные пары — в фоне, пока гость листает меню. Не успели или сервер
    // недоступен — остаются общие.
    useEffect(() => {
        if (!restaurantId) return undefined;
        let cancelled = false;
        pairingMemoryRef.current = loadMemory(restaurantId);
        setPersonalPairings(null);
        fetch(`${PAIRINGS_API}/api/guest/pairings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restaurantId, deviceId: getOrCreateDeviceId() }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
                if (!cancelled && json?.personal && json.pairings) setPersonalPairings(json.pairings);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [restaurantId]);

    useEffect(() => () => {
        clearTimeout(offerTimerRef.current);
        clearTimeout(toastTimerRef.current);
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

    // Переход «фото вырастает из карточки меню» — View Transitions (Safari 18+,
    // Chrome). Где их нет или включено «уменьшить движение» — обычное открытие.
    const canMorph = () => typeof document !== 'undefined' && !!document.startViewTransition
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const cardImageOf = (dishId) => {
        const img = document.querySelector(`img[data-dish-id="${dishId}"]`);
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight ? img : null;
    };

    const handleOpenModal = (dish, z = undefined, sourceImg = null) => {
    if (sourceImg && z === undefined && canMorph()) {
        sourceImg.style.viewTransitionName = 'dish-hero';
        document.startViewTransition(() => {
            sourceImg.style.viewTransitionName = '';
            flushSync(() => openModal(dish, z));
        });
        return;
    }
    openModal(dish, z);
};

    const closeModal = () => {
        const img = selectedDishForModal && dishModalZ === undefined ? cardImageOf(selectedDishForModal.id) : null;
        if (img && canMorph()) {
            const t = document.startViewTransition(() => {
                img.style.viewTransitionName = 'dish-hero';
                flushSync(() => setIsModalOpen(false));
            });
            t.finished.finally(() => { img.style.viewTransitionName = ''; });
            return;
        }
        setIsModalOpen(false);
    };

    const openModal = (dish, z) => {
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

    const menuById = useMemo(
        () => new Map(Object.values(groupedMenu).flat().map((d) => [d.id, d])),
        [groupedMenu]
    );

    const allItems = useMemo(() => [...menuById.values()], [menuById]);

    // Листание в карточке — только внутри раздела; из корзины (dishModalZ) — без листания.
    const modalSiblings = selectedDishForModal && dishModalZ === undefined
        ? groupedMenu[selectedDishForModal.menu_section]
        : undefined;
    const genericPairings = useMemo(() => expandPairingsByName(pairings, allItems), [pairings, allItems]);
    const personalPairingsByName = useMemo(() => expandPairingsByName(personalPairings, allItems), [personalPairings, allItems]);

    // «Шеф советует к этому» в карточке блюда — та же пара, что в подсказке.
    const modalPair = useMemo(() => {
        if (!selectedDishForModal) return null;
        const list = (personalPairingsByName ? personalPairingsByName[selectedDishForModal.id] : genericPairings[selectedDishForModal.id]) || [];
        const p = list.find((x) => menuById.has(x.dishId) && x.dishId !== selectedDishForModal.id);
        if (!p) return null;
        return { dish: menuById.get(p.dishId), lead: p.lead, why: p.why, inCart: (cart[p.dishId] || 0) > 0 };
    }, [selectedDishForModal, personalPairingsByName, genericPairings, menuById, cart]);

    const logPairing = useCallback((o, outcome) => {
        supabase.rpc('log_menu_pairing_event', {
            p_restaurant_id: restaurantId,
            p_device_id: getOrCreateDeviceId(),
            p_anchor_dish_id: o.logAnchorId || o.anchorId,
            p_dish_id: o.dishId,
            p_outcome: outcome,
            p_personal: !!o.personal,
        }).then(() => {}, () => {});
    }, [restaurantId]);

    // Изменение корзины из меню и карточки блюда. При первом добавлении блюда
    // (0 → 1) — подсказка шефа с парой, по правилам из lib/pairingRules.
    const updateCartWithPairing = (delta, dishId) => {
        const prevCount = cart[dishId] || 0;
        updateCart(delta, dishId);
        if (delta <= 0 || offer || !restaurantId) return;
        const memory = pairingMemoryRef.current || loadMemory(restaurantId);
        const next = pickPairing({
            dishId,
            prevCount,
            cart: { ...cart, [dishId]: prevCount + delta },
            menuById,
            generic: genericPairings,
            personal: personalPairingsByName,
            memory,
            now: Date.now(),
            ignoreLimits: PAIRINGS_TEST_MODE,
        });
        if (!next) return;
        pairingMemoryRef.current = rememberShown(memory, Date.now());
        saveMemory(restaurantId, pairingMemoryRef.current);
        // Короткая пауза: сначала гость видит, что блюдо добавилось.
        clearTimeout(offerTimerRef.current);
        offerTimerRef.current = setTimeout(() => setOffer(next), 250);
    };

    const answerOffer = (accepted) => {
        if (!offer) return;
        pairingMemoryRef.current = rememberAnswer(pairingMemoryRef.current, offer, accepted);
        saveMemory(restaurantId, pairingMemoryRef.current);
        logPairing(offer, accepted ? 'accepted' : 'rejected');
        if (accepted) {
            updateCart(1, offer.dishId);
            const name = menuById.get(offer.dishId)?.dish_name;
            if (name) {
                setToast(`${name} — в заказе`);
                clearTimeout(toastTimerRef.current);
                toastTimerRef.current = setTimeout(() => setToast(''), 2000);
            }
        }
        setOffer(null);
    };

    // «+» / «−» на карточке: раньше была галочка «выбрано/не выбрано», теперь
    // количество меняется прямо в меню, без захода в карточку блюда.
    const changeCount = (e, dishId, delta) => {
        e.stopPropagation();
        if (delta < 0 && !(cart[dishId] > 0)) return;
        updateCartWithPairing(delta, dishId);
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
                                            onClick={(e) => handleOpenModal(dish, undefined, e.currentTarget.querySelector('img'))}
                                        >
                                            {dish.image_url && (
                                                <img
                                                    data-dish-id={dish.id}
                                                    src={dish.image_url}
                                                    alt={dish.dish_name}
                                                    className={styles.dishImage}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            )}
                                        </div>
                                        <p className={styles.dishName} onClick={(e) => handleOpenModal(dish, undefined, e.currentTarget.parentElement.querySelector('img'))}>{dish.dish_name}</p>
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
                onRequestClose={closeModal}
                dish={selectedDishForModal}
                currentCount={selectedDishForModal ? (cart[selectedDishForModal.id] || 0) : 0}
                updateCart={updateCartWithPairing}
                onOpenChat={onOpenChat}
                overlayZIndex={dishModalZ}
                siblings={modalSiblings}
                onDishChange={(d) => { trackDishView(d.dish_name); setSelectedDishForModal(d); }}
                pair={modalPair}
            />

            <PairingSheet
                offer={offer}
                dish={offer ? menuById.get(offer.dishId) : null}
                onAccept={() => answerOffer(true)}
                onDecline={() => answerOffer(false)}
            />

            {toast && <div className={styles.toast} role="status">{toast}</div>}

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
