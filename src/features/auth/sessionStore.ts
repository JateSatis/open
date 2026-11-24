import type { Session } from '@supabase/supabase-js';

import { resetRecentSearches } from '@/features/search/recentSearches';
import { selectApiClient } from '@/api/supabase';
import { AccountSession } from './accountSession';
import {
  cleanAccountStorage, readAccounts, readAccountSession, saveAccountSession, writeAccounts,
  type Accounts, type AccountSlot,
} from './accountStorage';
import { withAccountIndex, withSessionChange } from './sessionChange';
import { ownerOf, sameSession, type SessionOwner } from './sessionOwner';
import { emptyState, useSessionStore } from './sessionState';

export { useSessionStore, type AuthBootstrap, type SessionState } from './sessionState';

let index: Accounts = { accounts: [], selected: null };
const clients = new Map<string, AccountSession>();
let restoring: Promise<void> | undefined;
let generation = 0;

export function getAccounts(): string[] {
  return index.accounts.map(slot => slot.userId);
}

export function getSelectedAccountId() {
  return index.selected;
}

function publish() {
  const selected = index.selected ? clients.get(index.selected) : undefined;
  const status = selected?.status ?? 'signedOut';
  selectApiClient(selected && status !== 'signedOut' ? selected.client : null);
  useSessionStore.setState({
    accounts: index.accounts,
    localSessionId: ownerOf(selected?.session ?? null)?.sessionId ?? selected?.slot.sessionId ?? null,
    localAccountId: status === 'signedOut' ? null : index.selected,
    sdkStatus: status,
    isLoading: status === 'pending',
    session: selected?.session ?? null,
    isAuthenticated: !!selected?.session,
  });
}

function dispose(runtime: AccountSession) {
  clients.delete(runtime.slot.userId);
  runtime.dispose();
}

async function remove(runtime: AccountSession) {
  if (clients.get(runtime.slot.userId) !== runtime) return;
  const { userId } = runtime.slot;
  const next = {
    accounts: index.accounts.filter(slot => slot.userId !== userId),
    selected: index.selected === userId ? null : index.selected,
  };
  await writeAccounts(next);
  index = next;
  dispose(runtime);
  resetRecentSearches(userId);
  publish();
  await cleanAccountStorage(next).catch(reportStorageError);
}

function observe(slot: AccountSlot, initial: Session | null = null): AccountSession {
  const existing = clients.get(slot.userId);
  if (existing) return existing;
  let owner = ownerOf(initial) ?? (slot.sessionId ? { userId: slot.userId, sessionId: slot.sessionId } : null);
  const runtime = new AccountSession(slot, initial, account => {
    const incoming = ownerOf(account.session);
    if (owner && incoming && !sameSession(owner, incoming)) {
      // Auth может выдать другой session_id в том же слоте (привязка провайдера).
      // Старые замыкания сохраняют остановленный клиент даже при том же user.id.
      dispose(account);
      resetRecentSearches(slot.userId);
      slot.sessionId = incoming.sessionId;
      observe(slot, account.session);
      if (index.selected === slot.userId) publish();
      return;
    }
    owner ??= incoming;
    if (account.status === 'signedOut') {
      void withAccountIndex(() => remove(account)).catch(reportStorageError);
    }
    if (index.selected === slot.userId) publish();
  });
  clients.set(slot.userId, runtime);
  return runtime;
}

function reportStorageError() {
  if (__DEV__) console.warn('Не удалось прочитать или сохранить аккаунты устройства');
}

/** Старые каталоги не сохраняли почту. Дочитываем её только при открытии списка. */
export async function loadAccountLabels(accounts: readonly AccountSlot[]) {
  const missing = accounts.filter(slot => slot.email === undefined);
  if (!missing.length) return;
  const labels = await Promise.all(missing.map(async slot => {
    const session = await readAccountSession(slot.key);
    return session?.user.id === slot.userId ? session.user.email ?? '' : '';
  }));
  if (accounts !== index.accounts) return;
  missing.forEach((slot, i) => { slot.email = labels[i]; });
  index = { ...index, accounts: [...accounts] };
  publish();
}

export async function savedSessionOwner(slot: AccountSlot) {
  const owner = ownerOf(clients.get(slot.userId)?.session ?? await readAccountSession(slot.key));
  return owner?.userId === slot.userId ? owner : undefined;
}

// В том числе для слотов этапа 14. Источник session_id — сохранённая SDK-сессия:
// процесс мог остановиться между её заменой и записью индекса аккаунтов.
async function readSlotOwner(slot: AccountSlot) {
  if (clients.has(slot.userId)) return;
  const session = await readAccountSession(slot.key);
  const owner = ownerOf(session);
  if (session?.user.id === slot.userId) slot.email = session.user.email;
  slot.sessionId = owner?.userId === slot.userId ? owner.sessionId : undefined;
}

export function restoreAccounts(): Promise<void> {
  const current = generation;
  restoring ??= withAccountIndex(async () => {
    const stored = await readAccounts();
    if (generation !== current) return;
    index = stored;
    const selected = index.accounts.find(slot => slot.userId === index.selected);
    if (selected) {
      await readSlotOwner(selected);
      if (generation !== current) return;
      observe(selected);
    }
    publish();
    await cleanAccountStorage(stored).catch(reportStorageError);
  }).catch((error: unknown) => {
    if (generation === current) restoring = undefined;
    throw error;
  });
  return restoring;
}

export async function selectAccount(userId: string, allowed = () => true) {
  await restoreAccounts();
  return withAccountIndex(async () => {
    const slot = index.accounts.find(account => account.userId === userId);
    if (!slot) throw new Error('Аккаунт отсутствует на устройстве');
    await readSlotOwner(slot);
    if (!allowed() || clients.get(userId)?.status === 'signedOut') return false;
    const next = { ...index, selected: userId };
    await writeAccounts(next);
    if (!allowed() || clients.get(userId)?.status === 'signedOut') {
      await writeAccounts(index);
      return false;
    }
    index = next;
    observe(slot);
    publish();
    return true;
  });
}

export async function addSession(session: Session, allowed = () => true) {
  await restoreAccounts();
  return withSessionChange(() => withAccountIndex(async () => {
    if (!allowed()) return false;
    const slot = await saveAccountSession(session);
    if (!allowed()) {
      await cleanAccountStorage(index).catch(reportStorageError);
      return false;
    }
    const next = {
      accounts: [...index.accounts.filter(account => account.userId !== slot.userId), slot],
      selected: slot.userId,
    };
    await writeAccounts(next);
    if (!allowed()) {
      await writeAccounts(index);
      await cleanAccountStorage(index).catch(reportStorageError);
      return false;
    }
    const previous = clients.get(slot.userId);
    if (previous) dispose(previous);
    if (index.accounts.some(account => account.userId === slot.userId)) resetRecentSearches(slot.userId);
    index = next;
    observe(slot, session);
    publish();
    await cleanAccountStorage(next).catch(reportStorageError);
    return true;
  }));
}

// Блокировка общая с привязкой провайдера и добавлением сессии того же user.id.
export async function signOutAccount(userId: string, expected?: SessionOwner, action?: {
  allowed: () => boolean;
  beforeRemove: (account: AccountSession) => Promise<void>;
}) {
  await restoreAccounts();
  const slot = index.accounts.find(account => account.userId === userId);
  if (!slot) return;
  await withSessionChange(async () => {
    if (!index.accounts.includes(slot) || (action && !action.allowed())) return;
    await readSlotOwner(slot);
    const runtime = observe(slot);
    async function matchesOwner() {
      if (!expected) return true;
      const session = runtime.session ?? await readAccountSession(runtime.slot.key);
      return sameSession(expected, ownerOf(session));
    }
    if (!(await matchesOwner())) return;
    await action?.beforeRemove(runtime);
    if (!(await matchesOwner())) return;
    const channels = runtime.client.getChannels();
    await Promise.allSettled(channels.map(channel => runtime.client.removeChannel(channel)));
    if (!(await matchesOwner())) return;
    try {
      await runtime.client.auth.signOut({ scope: 'local' });
    } catch {
      // Даже при сетевой ошибке SDK локальный выход должен завершиться.
    }
    await withAccountIndex(() => remove(runtime));
  });
}

let subscribers = 0;
export function subscribeToSession() {
  subscribers++;
  if (subscribers === 1) {
    const current = generation;
    void restoreAccounts().catch(async () => {
      if (generation !== current) return;
      try {
        await restoreAccounts();
      } catch {
        if (generation !== current) return;
        reportStorageError();
        // Диск недоступен. Можно повторить вход; до чтения индекса запись запрещена.
        useSessionStore.setState({ ...emptyState, localAccountId: null, isLoading: false, sdkStatus: 'signedOut' });
      }
    });
  }
  return () => {
    if (--subscribers !== 0) return;
    generation++;
    restoring = undefined;
    void withAccountIndex(async () => {
      for (const runtime of clients.values()) dispose(runtime);
      index = { accounts: [], selected: null };
      selectApiClient(null);
      useSessionStore.setState(emptyState);
    });
  };
}
