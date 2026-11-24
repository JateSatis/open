import type { Session } from '@supabase/supabase-js';

import { selectApiClient } from '@/api/supabase';
import { AccountSession } from './accountSession';
import {
  cleanAccountStorage, readAccounts, readAccountSession, saveAccountSession, writeAccounts,
  type Accounts, type AccountSlot,
} from './accountStorage';
import { withSessionChange } from './sessionChange';
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
      slot.sessionId = incoming.sessionId;
      observe(slot, account.session);
      if (index.selected === slot.userId) publish();
      return;
    }
    owner ??= incoming;
    if (account.status === 'signedOut') {
      void withSessionChange(() => remove(account)).catch(reportStorageError);
    }
    if (index.selected === slot.userId) publish();
  });
  clients.set(slot.userId, runtime);
  return runtime;
}

function reportStorageError() {
  if (__DEV__) console.warn('Не удалось прочитать или сохранить аккаунты устройства');
}

// В том числе для слотов этапа 14. Источник session_id — сохранённая SDK-сессия:
// процесс мог остановиться между её заменой и записью индекса аккаунтов.
async function readSlotOwner(slot: AccountSlot) {
  if (clients.has(slot.userId)) return;
  const owner = ownerOf(await readAccountSession(slot.key));
  slot.sessionId = owner?.userId === slot.userId ? owner.sessionId : undefined;
}

export function restoreAccounts(): Promise<void> {
  const current = generation;
  restoring ??= withSessionChange(async () => {
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

export async function selectAccount(userId: string) {
  await restoreAccounts();
  await withSessionChange(async () => {
    const slot = index.accounts.find(account => account.userId === userId);
    if (!slot) throw new Error('Аккаунт отсутствует на устройстве');
    await readSlotOwner(slot);
    const next = { ...index, selected: userId };
    await writeAccounts(next);
    index = next;
    observe(slot);
    publish();
  });
}

export async function addSession(session: Session) {
  await restoreAccounts();
  await withSessionChange(async () => {
    const slot = await saveAccountSession(session);
    const next = {
      accounts: [...index.accounts.filter(account => account.userId !== slot.userId), slot],
      selected: slot.userId,
    };
    await writeAccounts(next);
    const previous = clients.get(slot.userId);
    if (previous) dispose(previous);
    index = next;
    observe(slot, session);
    publish();
    await cleanAccountStorage(next).catch(reportStorageError);
  });
}

// Блокировка общая с привязкой провайдера и добавлением сессии того же user.id.
export async function signOutAccount(userId: string, expected?: SessionOwner) {
  await restoreAccounts();
  const slot = index.accounts.find(account => account.userId === userId);
  if (!slot) return;
  await withSessionChange(async () => {
    if (!index.accounts.includes(slot)) return;
    const runtime = observe(slot);
    async function matchesOwner() {
      if (!expected) return true;
      const session = runtime.session ?? await readAccountSession(runtime.slot.key);
      return sameSession(expected, ownerOf(session));
    }
    if (!(await matchesOwner())) return;
    const channels = runtime.client.getChannels();
    await Promise.allSettled(channels.map(channel => runtime.client.removeChannel(channel)));
    if (!(await matchesOwner())) return;
    try {
      await runtime.client.auth.signOut({ scope: 'local' });
    } catch {
      // Даже при сетевой ошибке SDK локальный выход должен завершиться.
    }
    await remove(runtime);
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
    void withSessionChange(async () => {
      for (const runtime of clients.values()) dispose(runtime);
      index = { accounts: [], selected: null };
      selectApiClient(null);
      useSessionStore.setState(emptyState);
    });
  };
}
