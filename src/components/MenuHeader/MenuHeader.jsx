import { useEffect, useRef } from 'react';
import styles from './MenuHeader.module.css';

export default function MenuHeader({ sections, activeSection, onSectionClick }) {
    // Реф для прокручиваемого контейнера
    const scrollContainerRef = useRef(null);
    // Объект для хранения рефов каждой кнопки
    const buttonRefs = useRef({});

    useEffect(() => {
        const activeBtn = buttonRefs.current[activeSection];
        const container = scrollContainerRef.current;

        if (activeBtn && container) {
            // Рассчитываем позицию: активная кнопка в 22px от левого края
            let targetScroll = activeBtn.offsetLeft - 22;

            // Максимально возможный скролл
            const maxScroll = container.scrollWidth - container.clientWidth;

            // Ограничители
            if (targetScroll > maxScroll) targetScroll = maxScroll;
            if (targetScroll < 0) targetScroll = 0;

            container.scrollTo({
                left: targetScroll,
                behavior: 'smooth'
            });
        }
    }, [activeSection]);

    return (
        <header className={styles.headerContainer}>
            {/* БЛОК ЛОГОТИПА УДАЛЕН */}

            {/* Слайдер разделов */}
            <nav 
                className={styles.categorySlider} 
                ref={scrollContainerRef}
            >
                {sections.map((section) => (
                    <button
                        key={section}
                        ref={(el) => (buttonRefs.current[section] = el)}
                        className={`${styles.categoryButton} ${
                            activeSection === section ? styles.active : ''
                        }`}
                        onClick={() => onSectionClick(section)}
                    >
                        {section}
                    </button>
                ))}
            </nav>

            {/* Линия-разделитель в самом низу */}
            <div className={styles.divider}></div>
        </header>
    );
}
