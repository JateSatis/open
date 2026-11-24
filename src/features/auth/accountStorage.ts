import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

import { legacySessionKey } from '@/api/supabase';
import { ownerOf } from './sessionOwner';
import { randomUuid } from '@/lib/uuid';

export type AccountSlot = { userId: string; key: string; sessionId?: string };
export type Accounts = { accounts: AccountSlot[]; selected: string | null };

const indexKey = legacySessionKey + ':accounts';
const slotPrefix = legacySessionKey + ':session:';

export function readAccountSession(key: string) {
  return AsyncStorage.getItem(key).then(raw => {
    if (!raw) return null;
    try {
      const session: Session | null = JSON.parse(raw);
      return [session?.user?.id, session?.access_token, session?.refresh_token].every(
        field => typeof field === 'string' && field.trim().length > 0,
      ) ? session : null;
    } catch {
      return null;
    }
  });
}

export function writeAccounts(accounts: Accounts) {
  return AsyncStorage.setItem(indexKey, JSON.stringify(accounts));
}

export async function saveAccountSession(session: Session) {
  const slot = { userId: session.user.id, sessionId: ownerOf(session)?.sessionId, key: slotPrefix + randomUuid() };
  await AsyncStorage.setItem(slot.key, JSON.stringify(session));
  return slot;
}

export async function readAccounts(): Promise<Accounts> {
  const stored = await AsyncStorage.getItem(indexKey);
  if (stored !== null) return JSON.parse(stored) as Accounts;

  const legacy = await readAccountSession(legacySessionKey);
  const accounts: Accounts = { accounts: [], selected: null };
  if (legacy) {
    // Один и тот же адрес при повторе после прерванного копирования.
    const slot = { userId: legacy.user.id, sessionId: ownerOf(legacy)?.sessionId, key: slotPrefix + 'legacy' };
    await AsyncStorage.setItem(slot.key, JSON.stringify(legacy));
    accounts.accounts.push(slot);
    accounts.selected = slot.userId;
  }
  await writeAccounts(accounts);
  return accounts;
}

// Вызывается под общей очередью записей. Даже пустой индекс завершает миграцию.
// Убираем также ключи, оставшиеся при остановке между записью сессии и индекса.
export async function cleanAccountStorage(index: Accounts) {
  const keys = await AsyncStorage.getAllKeys();
  const sdkKeys = (key: string) => [key, key + '-code-verifier', key + '-user'];
  const legacy = sdkKeys(legacySessionKey);
  const kept = new Set(index.accounts.flatMap(slot => sdkKeys(slot.key)));
  const obsolete = keys.filter(key => legacy.includes(key) || (key.startsWith(slotPrefix) && !kept.has(key)));
  if (obsolete.length) await AsyncStorage.multiRemove(obsolete);
}
