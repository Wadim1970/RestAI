import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co';
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Дефолтные значения (фолбэк)
const DEFAULT_BRANDING = {
  primaryColor: '#304D22',
  accentColor: '#48BF48',
  backgroundColor: '#ffffff',
  priceBgColor: '#E5E0D4',
  headingFont: 'Manrope',
  bodyFont: 'Inter',
};

export const useBrandingConfig = (restaurantId) => {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }

    const fetchBranding = async () => {
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('restaurants')
          .select(
            'branding_primary_color, branding_accent_color, branding_background_color, branding_price_bg_color, branding_heading_font, branding_body_font'
          )
          .eq('id', restaurantId)
          .single();

        if (fetchError) throw fetchError;

        if (data) {
          setBranding({
            primaryColor: data.branding_primary_color || DEFAULT_BRANDING.primaryColor,
            accentColor: data.branding_accent_color || DEFAULT_BRANDING.accentColor,
            backgroundColor: data.branding_background_color || DEFAULT_BRANDING.backgroundColor,
            priceBgColor: data.branding_price_bg_color || DEFAULT_BRANDING.priceBgColor,
            headingFont: data.branding_heading_font || DEFAULT_BRANDING.headingFont,
            bodyFont: data.branding_body_font || DEFAULT_BRANDING.bodyFont,
          });
        }
      } catch (err) {
        console.error('Ошибка загрузки брендинга:', err);
        setError(err.message);
        setBranding(DEFAULT_BRANDING);
      } finally {
        setLoading(false);
      }
    };

    fetchBranding();
  }, [restaurantId]);

  return { branding, loading, error };
};
