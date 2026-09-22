import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/api/types.gen';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.',
  );
}

// Схема базы прокинута в клиент: отсюда типы строк, аргументов rpc и разбор
// select-строк вместе со встроенными таблицами. Без неё каждый запрос
// возвращал бы `any`, и ряды приходилось бы описывать руками рядом с каждым
// запросом — а значит, расходиться со схемой при первой же миграции.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase's token auto-refresh relies on a timer that keeps firing in the
// background unless it is tied to AppState — otherwise refreshes pile up
// while the app is backgrounded and the session can end up expired on return.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
