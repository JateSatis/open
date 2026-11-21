import AsyncStorage from '@react-native-async-storage/async-storage';

import { AccountClient } from '@/api/accountClient';
import { withRequestDeadline } from '@/api/requestDeadline';
import { randomUuid } from '@/lib/uuid';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

export const legacySessionKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

export function createAccountClient(storageKey?: string) {
  const client = new AccountClient(url!, anonKey!, {
    auth: {
      storage: storageKey ? AsyncStorage : undefined,
      storageKey: storageKey ?? `${legacySessionKey}:memory:${randomUuid()}`,
      persistSession: !!storageKey,
      autoRefreshToken: !!storageKey,
      detectSessionInUrl: false,
    },
    global: { fetch: withRequestDeadline((input, init) => fetch(input, init)) },
    db: { retry: false },
  });
  client.isSelected = () => client === supabase;
  return client;
}

const anonymous = createAccountClient();
// Живая привязка для существующих API. В момент вызова они получают выбранный клиент.
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
  supabase = next;
  if (!previous.getChannels().length) void previous.realtime.disconnect();
  for (const listener of listeners) listener();
}
