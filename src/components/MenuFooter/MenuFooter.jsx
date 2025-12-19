// src/components/MenuFooter/MenuFooter.jsx

import styles from './MenuFooter.module.css';

// --- ИКОНКИ ---
// Предполагаем, что файлы иконок находятся в public/icons

const Avatar = () => (
    <img src="/icons/foto-avatar.png" alt="Аватар" className={styles.chatAvatar} />
);

// Иконка Корзины: меняет цвет на белый, если isActive = true
const Basket = ({ isActive }) => (
      <img 
        src="/icons/free-icon-basket.png" 
        alt="Корзина" 
        className={styles.orderIcon} 
            
     />
);

const Bell = () => (
    <img src="/icons/free-icon-notification-bell.png" alt="Звонок" className={styles.callIcon} />
);


export default function MenuFooter({ orderActive = false, onChatClick, onOrderClick, onCallClick }) {
 
    return (
        <footer className={styles.footerContainer}>
            <div className={styles.buttonArea}>

                {/* 1. Кнопка Чата */}
                <div className={styles.navItem}>
                    <button className={`${styles.navButton} ${styles.chatButton}`} onClick={onChatClick}>
                        <Avatar />
                    </button>
                    <span className={styles.label}>Чат</span>
                </div>

                {/* 2. Кнопка Заказа (Корзина) - Управляется ТОЛЬКО классом .active */}
                <div className={styles.navItem}>
                    <button 
                        // Динамически добавляем/удаляем класс styles.active
                        className={`${styles.navButton} ${styles.orderButton} ${orderActive ? styles.active : ''}`} 
                        onClick={onOrderClick}
                        
                    >
                        <Basket />
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