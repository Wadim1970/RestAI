import React, { useEffect } from 'react';
import { useBranding } from '../context/BrandingContext';

export const ThemeProvider = ({ children }) => {
  const { branding } = useBranding();

  useEffect(() => {
    // Применяем CSS переменные к корневому элементу
    const root = document.documentElement;
    
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-accent', branding.accentColor);
    root.style.setProperty('--color-background', branding.backgroundColor);
    root.style.setProperty('--color-price-bg', branding.priceBgColor);
    root.style.setProperty('--font-heading', `"${branding.headingFont}", sans-serif`);
    root.style.setProperty('--font-body', `"${branding.bodyFont}", sans-serif`);

    // Также устанавливаем глобальные стили body
    document.body.style.backgroundColor = branding.backgroundColor;
    document.body.style.fontFamily = `"${branding.bodyFont}", sans-serif`;
  }, [branding]);

  return <>{children}</>;
};
