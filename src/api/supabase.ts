import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { withRequestDeadline } from '@/api/requestDeadline';
import type { Database } from '@/api/database';

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
// The existing Supabase storage key, shared with the offline account bootstrap.
const sessionStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
export async function readStoredSession() {
  const raw = await AsyncStorage.getItem(sessionStorageKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as import('@supabase/supabase-js').Session | null;
  return value?.user?.id && value.refresh_token && value.access_token ? value : null;
}
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: sessionStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    // Ни один запрос не висит вечно — см. `requestDeadline.ts`. Вызов через
    // стрелку: глобальный `fetch` берётся в момент запроса, а не создания клиента.
    fetch: withRequestDeadline((input, init) => fetch(input, init)),
  },
  db: {
    // Свои повторы PostgREST (до трёх, паузы 1/2/4 с) складывались бы с
    // повторами React Query, и сбой доходил бы до экрана за минуту с лишним.
    // Повторяет один слой — React Query.
    retry: false,
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
