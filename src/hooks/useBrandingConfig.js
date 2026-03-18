import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://utdfzrpkoscyikitceow.supabase.co';
const supabaseAnonKey = 'sb_publishable_a2-xBdfgS2KCwRUiA4-JDw_Pl8Q-L83';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Дефолтные значения
const DEFAULT_BRANDING = {
  primaryColor: '#304D22',
  accentColor: '#48BF48',
  backgroundColor: '#ffffff',
  priceBgColor: '#E5E0D4',
  branding_heading_font: 'Manrope',
  branding_body_font: 'Inter',
  font_url_header: null,
  font_url_body: null,
};

export const useBrandingConfig = (restaurantId) => {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      setBranding(DEFAULT_BRANDING);
      return;
    }

    const fetchBranding = async () => {
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('restaurants')
          .select(
            'name, branding_primary_color, branding_accent_color, branding_background_color, branding_price_bg_color, branding_heading_font, branding_body_font, font_url_header, font_url_body'
          )
          .eq('restaurantId', restaurantId)
          .single();

        if (fetchError) throw fetchError;

        if (data) {
          setBranding({
            name: data.name || 'Ресторан', // <-- ДОБАВИТЬ ЭТУ СТРОКУ
            primaryColor: data.branding_primary_color || DEFAULT_BRANDING.primaryColor,
            accentColor: data.branding_accent_color || DEFAULT_BRANDING.accentColor,
            backgroundColor: data.branding_background_color || DEFAULT_BRANDING.backgroundColor,
            priceBgColor: data.branding_price_bg_color || DEFAULT_BRANDING.priceBgColor,
            branding_heading_font: data.branding_heading_font || DEFAULT_BRANDING.branding_heading_font,
            branding_body_font: data.branding_body_font || DEFAULT_BRANDING.branding_body_font,
            font_url_header: data.font_url_header || null,
            font_url_body: data.font_url_body || null,
          });
          
          console.log('✅ Брендинг загружен:', data);
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки брендинга:', err);
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
