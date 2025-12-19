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
            // Рассчитываем позицию: кнопка в 22px (1.375rem) от левого края
            // Используем 22 вместо rem для точности расчета в пикселях
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
            {/* Область логотипа */}
            <div className={styles.logoArea}>
                <img src="/icons/logo-rest.png" alt="Logo" className={styles.logoImage} />
            </div>

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

            {/* Линия-разделитель */}
            <div className={styles.divider}></div>
        </header>
    );
}