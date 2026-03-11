import React, { useEffect } from 'react';
import { useBranding } from '../context/BrandingContext';

export const ThemeProvider = ({ children }) => {
  const { branding } = useBranding(); // ✅ Это работает, потому что ThemeProvider внутри BrandingProvider

  // ==========================================
  // ЭФФЕКТ 1: Загрузка Google Fonts динамически
  // ==========================================
  useEffect(() => {
    if (!branding.headingFont || !branding.bodyFont) return; // ✅ Проверка на наличие данных

    const headingFont = encodeURIComponent(branding.headingFont);
    const bodyFont = encodeURIComponent(branding.bodyFont);
    
    const fontUrl = `https://fonts.googleapis.com/css2?family=${headingFont}:wght@400;600;700&family=${bodyFont}:wght@400;500;600&display=swap`;
    
    const link = document.createElement('link');
    link.href = fontUrl;
    link.rel = 'stylesheet';
    link.id = 'dynamic-fonts-link';
    
    const oldLink = document.getElementById('dynamic-fonts-link');
    if (oldLink) {
      oldLink.remove();
    }
    
    document.head.appendChild(link);
    
    console.log('🎨 Загружены шрифты:', branding.headingFont, 'и', branding.bodyFont);
    
    return () => {
      const linkToRemove = document.getElementById('dynamic-fonts-link');
      if (linkToRemove) {
        linkToRemove.remove();
      }
    };
  }, [branding.headingFont, branding.bodyFont]);

  // ==========================================
  // ЭФФЕКТ 2: Применение CSS переменных к DOM
  // ==========================================
  useEffect(() => {
    const root = document.documentElement;
    
    root.style.setProperty('--color-primary', branding.primaryColor || '#304D22');
    root.style.setProperty('--color-accent', branding.accentColor || '#48BF48');
    root.style.setProperty('--color-background', branding.backgroundColor || '#ffffff');
    root.style.setProperty('--color-price-bg', branding.priceBgColor || '#E5E0D4');
    root.style.setProperty('--font-heading', `"${branding.headingFont || 'Manrope'}", sans-serif`);
    root.style.setProperty('--font-body', `"${branding.bodyFont || 'Inter'}", sans-serif`);

    document.body.style.backgroundColor = branding.backgroundColor || '#ffffff';
    document.body.style.fontFamily = `"${branding.bodyFont || 'Inter'}", sans-serif`;
    document.body.style.color = branding.primaryColor || '#304D22';
    
    console.log('🎨 Применены цвета:', branding);
  }, [branding]);

  return <>{children}</>;
};
