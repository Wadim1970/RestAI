// src/components/MenuFooter/MenuFooter.jsx

import styles from './MenuFooter.module.css';

// --- ИКОНКИ ---
const Avatar = () => (
    <img src="/icons/foto-avatar.png" alt="Аватар" className={styles.chatAvatar} />
);

const Basket = ({ isActive }) => (
    <div
        className={`${styles.orderIcon} ${isActive ? styles.orderIconActive : ''}`}
        role="img"
        aria-label="Корзина"
    />
);

const Bell = () => (
    <img src="/icons/free-icon-notification-bell.png" alt="Звонок" className={styles.callIcon} />
);

export default function MenuFooter({ orderActive = false, onChatClick, onOrderClick, onCallClick }) {
 
    return (
        <footer className={styles.footerContainer}>
            <div className={styles.buttonArea}>

                {/* 1. Кнопка Чата - теперь она связана с onOpenChat из App.js */}
                <div className={styles.navItem}>
                    <button className={`${styles.navButton} ${styles.chatButton}`} onClick={onChatClick}>
                        <Avatar />
                    </button>
                    <span className={styles.label}>Чат</span>
                </div>

                {/* 2. Кнопка Заказа (Корзина) */}
                <div className={styles.navItem}>
                    <button 
                        className={`${styles.navButton} ${styles.orderButton} ${orderActive ? styles.active : ''}`} 
                        onClick={onOrderClick}
                        disabled={!orderActive}
                    >
                        <Basket isActive={orderActive} />
                    </button>
                    <span className={styles.label}>Заказ</span>
                </div>

                {/* 3. Кнопка Вызова официанта */}
                <div className={styles.navItem}>
                    <button className={`${styles.navButton} ${styles.callButton}`} onClick={onCallClick}>
                        <Bell />
                    </button>
                    <span className={styles.label}>Вызов официанта</span>
                </div>

            </div>
        </footer>
    );
}
