import { createClient } from '@supabase/supabase-js';

// Забираем ключи из переменных окружения Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Инициализируем клиента
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
