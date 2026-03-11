import React, { useEffect } from 'react';
import { useBranding } from '../context/BrandingContext';

export const ThemeProvider = ({ children }) => {
  const { branding } = useBranding();

  // ==========================================
  // ЭФФЕКТ 1: Загрузка Google Fonts динамически
  // ==========================================
  useEffect(() => {
    // Преобразуем названия шрифтов для Google Fonts API
    const headingFont = encodeURIComponent(branding.headingFont);
    const bodyFont = encodeURIComponent(branding.bodyFont);
    
    // Создаем URL для Google Fonts
    // Загружаем разные weights в зависимости от типа шрифта
    const fontUrl = `https://fonts.googleapis.com/css2?family=${headingFont}:wght@400;600;700&family=${bodyFont}:wght@400;500;600&display=swap`;
    
    // Создаем элемент <link> для подключения шрифтов
    const link = document.createElement('link');
    link.href = fontUrl;
    link.rel = 'stylesheet';
    link.id = 'dynamic-fonts-link'; // Даем ID, чтобы потом удалить старый
    
    // Удаляем старую ссылку на шрифты (если она есть)
    const oldLink = document.getElementById('dynamic-fonts-link');
    if (oldLink) {
      oldLink.remove();
    }
    
    // Добавляем новую ссылку в <head>
    document.head.appendChild(link);
    
    // Логирование для отладки
    console.log('🎨 Загружены шрифты:', branding.headingFont, 'и', branding.bodyFont);
    
    // Очищаем старые шрифты при размонтировании компонента
    return () => {
      const linkToRemove = document.getElementById('dynamic-fonts-link');
      if (linkToRemove) {
        linkToRemove.remove();
      }
    };
  }, [branding.headingFont, branding.bodyFont]); // Срабатывает при изменении шрифтов

  // ==========================================
  // ЭФФЕКТ 2: Применение CSS переменных к DOM
  // ==========================================
  useEffect(() => {
    // Получаем корневой элемент документа
    const root = document.documentElement;
    
    // Устанавливаем CSS переменные для цветов
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-accent', branding.accentColor);
    root.style.setProperty('--color-background', branding.backgroundColor);
    root.style.setProperty('--color-price-bg', branding.priceBgColor);
    
    // Устанавливаем CSS переменные для шрифтов
    // Оборачиваем в кавычки, чтобы шрифты с пробелами работали корректно
    root.style.setProperty('--font-heading', `"${branding.headingFont}", sans-serif`);
    root.style.setProperty('--font-body', `"${branding.bodyFont}", sans-serif`);

    // Применяем стили к body для глобального эффекта
    document.body.style.backgroundColor = branding.backgroundColor;
    document.body.style.fontFamily = `"${branding.bodyFont}", sans-serif`;
    document.body.style.color = branding.primaryColor;
    
    // Логирование для отладки
    console.log('🎨 Применены цвета:', {
      primary: branding.primaryColor,
      accent: branding.accentColor,
      background: branding.backgroundColor,
    });
  }, [branding]); // Срабатывает при изменении любого параметра брендинга

  // Возвращаем children с применением вс��х стилей
  return <>{children}</>;
};
