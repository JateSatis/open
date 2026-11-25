import type { AccountClient } from '@/api/accountClient';
import type { AccountSlot } from './accountStorage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export type SessionState = {
  session: Session | null;
  isAuthenticated: boolean;
  /** Ожидаем ответ SDK или чтение сохранённой сессии после сетевой ошибки. */
  isLoading: boolean;
};

export type AuthBootstrap = {
  localSessionId?: string | null;
  /** undefined — чтение идёт, null — владельца нет. */
  localAccountId: string | null | undefined;
  /** session означает получение сессии от SDK, в том числе из его кеша. */
  sdkStatus: 'pending' | 'session' | 'signedOut' | 'offline';
};

type DeviceState = SessionState & AuthBootstrap & { accounts: readonly AccountSlot[] };

export const emptyState: DeviceState = {
  accounts: [],
  session: null,
  isAuthenticated: false,
  isLoading: true,
  localSessionId: null,
  localAccountId: undefined,
  sdkStatus: 'pending',
};

export const useSessionStore = create<DeviceState>(() => emptyState);

export function confirmedAccountId({ sdkStatus, session }: SessionState & AuthBootstrap) {
  return sdkStatus === 'session' ? session?.user.id ?? null : null;
}

export function requireAccountSession(owner: string | null | undefined, api: AccountClient) {
  if (owner && api.sessionOwner?.()?.userId !== owner) {
    throw new Error('Требуется активная сессия аккаунта');
  }
}
