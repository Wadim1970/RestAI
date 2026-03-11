import React, { useEffect } from 'react';
import { useBranding } from '../context/BrandingContext';

export const ThemeProvider = ({ children }) => {
  const { branding } = useBranding();

  // ==========================================
  // ЭФФЕКТ 1: Загрузка Google Fonts динамически
  // ==========================================
  useEffect(() => {
    // ✅ ИСПРАВЛЕНИЕ: используем правильные названия полей из таблицы
    if (!branding.font_url_header && !branding.font_url_body) {
      console.warn('⚠️ URLs шрифтов не найдены в таблице');
      return;
    }

    // Если есть оба URL, объединяем их в один запрос
    let fontUrl = '';
    
    if (branding.font_url_header && branding.font_url_body) {
      // Оба URL существуют - нужно их правильно объединить
      const headerUrl = branding.font_url_header.replace('&display=swap', '');
      const bodyUrl = branding.font_url_body.replace('&display=swap', '');
      
      // Извлекаем только часть с семейством шрифтов из второго URL
      const bodyFamily = bodyUrl.replace('https://fonts.googleapis.com/css2?family=', '');
      
      fontUrl = `${headerUrl}&family=${bodyFamily}&display=swap`;
    } else if (branding.font_url_header) {
      fontUrl = branding.font_url_header;
    } else if (branding.font_url_body) {
      fontUrl = branding.font_url_body;
    }

    const link = document.createElement('link');
    link.href = fontUrl;
    link.rel = 'stylesheet';
    link.id = 'dynamic-fonts-link';
    
    const oldLink = document.getElementById('dynamic-fonts-link');
    if (oldLink) {
      oldLink.remove();
    }
    
    document.head.appendChild(link);
    
    console.log('🎨 Загружены шрифты с URL:', fontUrl);
    
    return () => {
      const linkToRemove = document.getElementById('dynamic-fonts-link');
      if (linkToRemove) {
        linkToRemove.remove();
      }
    };
  }, [branding.font_url_header, branding.font_url_body]);

  // ==========================================
  // ЭФФЕКТ 2: Применение CSS переменных к DOM
  // ==========================================
  useEffect(() => {
    // ✅ ИСПРАВЛЕНИЕ: используем правильные названия полей
    const headingFont = branding.branding_heading_font || 'Manrope';
    const bodyFont = branding.branding_body_font || 'Inter';

    const root = document.documentElement;
    
    root.style.setProperty('--color-primary', branding.primaryColor || '#304D22');
    root.style.setProperty('--color-accent', branding.accentColor || '#48BF48');
    root.style.setProperty('--color-background', branding.backgroundColor || '#ffffff');
    root.style.setProperty('--color-price-bg', branding.priceBgColor || '#E5E0D4');
    root.style.setProperty('--font-heading', `"${headingFont}", sans-serif`);
    root.style.setProperty('--font-body', `"${bodyFont}", sans-serif`);

    document.body.style.backgroundColor = branding.backgroundColor || '#ffffff';
    document.body.style.fontFamily = `"${bodyFont}", sans-serif`;
    document.body.style.color = branding.primaryColor || '#304D22';
    
    console.log('🎨 Применены шрифты и цвета:', {
      headingFont,
      bodyFont,
      primaryColor: branding.primaryColor,
      backgroundColor: branding.backgroundColor
    });
  }, [branding]);

  return <>{children}</>;
};
