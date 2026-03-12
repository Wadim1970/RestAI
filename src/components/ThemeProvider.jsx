import React, { useEffect } from 'react';
import { useBranding } from '../context/BrandingContext';

export const ThemeProvider = ({ children }) => {
  const { branding } = useBranding();

  // ==========================================
  // ЭФФЕКТ 1: Динамическая загрузка Google Fonts
  // ==========================================
  useEffect(() => {
    if (!branding) return;

    const headingFont = branding.branding_heading_font || 'Manrope';
    const bodyFont = branding.branding_body_font || 'Inter';

    const families = [];

    // Добавляем шрифт заголовков
    if (headingFont) {
      families.push(headingFont);
    }

    // Добавляем шрифт текста (если отличается)
    if (bodyFont && bodyFont !== headingFont) {
      families.push(bodyFont);
    }

    // Кодируем названия шрифтов (важно для шрифтов с пробелами)
    const fontUrl = `https://fonts.googleapis.com/css2?${families
      .map(font => `family=${encodeURIComponent(font)}`)
      .join('&')}&display=swap`;

    let link = document.getElementById('dynamic-fonts-link');

    // Если link уже существует — просто меняем URL
    if (link) {
      link.href = fontUrl;
    } else {
      link = document.createElement('link');
      link.id = 'dynamic-fonts-link';
      link.rel = 'stylesheet';
      link.href = fontUrl;
      document.head.appendChild(link);
    }

    console.log('🎨 Загружены Google Fonts:', families);

  }, [branding?.branding_heading_font, branding?.branding_body_font]);



  // ==========================================
  // ЭФФЕКТ 2: Применение цветов и шрифтов
  // ==========================================
  useEffect(() => {
    if (!branding) return;

    const headingFont = branding.branding_heading_font || 'Manrope';
    const bodyFont = branding.branding_body_font || 'Inter';

    const root = document.documentElement;

    const themeVars = {
      '--color-primary': branding.primaryColor || '#304D22',
      '--color-accent': branding.accentColor || '#48BF48',
      '--color-background': branding.backgroundColor || '#ffffff',
      '--color-price-bg': branding.priceBgColor || '#E5E0D4',
      '--font-heading': `"${headingFont}", sans-serif`,
      '--font-body': `"${bodyFont}", sans-serif`,
    };

    // Применяем CSS переменные
    Object.entries(themeVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    console.log('🎨 Применена тема ресторана:', {
      headingFont,
      bodyFont,
      primaryColor: branding.primaryColor,
      backgroundColor: branding.backgroundColor
    });

  }, [branding]);

  return <>{children}</>;
};
