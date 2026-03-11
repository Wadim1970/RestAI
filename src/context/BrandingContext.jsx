import React, { createContext, useContext } from 'react';

const BrandingContext = createContext(null);

export const BrandingProvider = ({ children, branding, loading }) => {
  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding должен быть использован внутри BrandingProvider');
  }
  return context;
};
