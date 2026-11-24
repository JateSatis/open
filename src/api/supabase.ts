import AsyncStorage from '@react-native-async-storage/async-storage';

import { changeRequestSelection } from './screenRequest';
import { AccountClient } from '@/api/accountClient';
import { withRequestDeadline } from '@/api/requestDeadline';
import { sessionIdOf } from '@/lib/jwt';
import { randomUuid } from '@/lib/uuid';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

export const legacySessionKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

export function createAccountClient(storageKey?: string) {
  const client: AccountClient = new AccountClient(url!, anonKey!, {
    auth: {
      storage: storageKey ? {
        getItem: key => AsyncStorage.getItem(key),
        setItem: (key, value) => client.retired ? Promise.resolve() : AsyncStorage.setItem(key, value),
        removeItem: key => client.retired ? Promise.resolve() : AsyncStorage.removeItem(key),
      } : undefined,
      storageKey: storageKey ?? `${legacySessionKey}:memory:${randomUuid()}`,
      persistSession: !!storageKey,
      autoRefreshToken: !!storageKey,
      detectSessionInUrl: false,
    },
    global: {
      fetch: withRequestDeadline((input, init) => {
        // Auth использует свой fetch (в обход accessToken), в том числе при unlink.
        // Проверяем фактический JWT непосредственно перед передачей транспорту.
        if (client.retired) throw new Error('Сессия аккаунта изменилась');
        if (client.sessionOwner) {
          const header = new Headers(init?.headers).get('Authorization');
          const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
          if (token && token !== anonKey) {
            const id = sessionIdOf(token);
            if (!id || id !== client.sessionOwner()?.sessionId) throw new Error('Сессия аккаунта изменилась');
          }
        }
        return fetch(input, init);
      }),
    },
    db: { retry: false },
  });
  return client;
}

const anonymous = createAccountClient();
// Точка выбора для requestClient() и наблюдателя состояния текущего сокета.
export let supabase = anonymous;
const listeners = new Set<() => void>();
export function watchApiClient(listener: () => void) {
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}

export function selectApiClient(client: AccountClient | null) {
  const next = client ?? anonymous;
  if (supabase === next) return;
  const previous = supabase;
  changeRequestSelection();
  supabase = next;
  if (!previous.getChannels().length) void previous.realtime.disconnect();
  for (const listener of listeners) listener();
}
