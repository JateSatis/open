// Аккаунт: способы входа, устройства и сеансы, выход и удаление.
//
// Список сеансов Supabase клиенту не отдаёт, поэтому устройства — своя
// приватная таблица `devices`. Писать в неё может только база: `session_id`
// берётся из JWT внутри функций, а не из запроса (миграция
// 20260926150000_account_devices.sql).

import type { AccountClient } from '@/api/accountClient';
import { requestClient } from '@/api/requestClient';
import type { UserIdentity } from '@supabase/supabase-js';

import { sessionAuthorization } from './sessionAuthorization';
import { sameSession, type SessionOwner } from '@/features/auth/sessionOwner';
import { withSessionChange } from '@/features/auth/sessionChange';
import { signOutAccount } from '@/features/auth/sessionStore';
import type { Tables } from '@/api/types.gen';

export type IdentityProvider = 'google' | 'apple';

export type SignInIdentity = {
  id: string;
  provider: string;
  /** Почта, которую прислал провайдер. У Apple может быть скрытой (privaterelay). */
  email: string | null;
};

type DeviceRow = Pick<
  Tables<'devices'>,
  'id' | 'installation_id' | 'platform' | 'model' | 'os_version' | 'app_version' | 'last_seen_at'
>;

export type Device = {
  id: string;
  installationId: string;
  platform: string;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string;
};

export type DeviceInfo = {
  installationId: string;
  platform: 'ios' | 'android' | 'web';
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
};

const DEVICE_COLUMNS = 'id, installation_id, platform, model, os_version, app_version, last_seen_at';

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    installationId: row.installation_id,
    platform: row.platform,
    model: row.model || null,
    osVersion: row.os_version || null,
    appVersion: row.app_version || null,
    lastSeenAt: row.last_seen_at,
  };
}

function emailOf(identity: UserIdentity): string | null {
  const email = identity.identity_data?.email;

  return typeof email === 'string' && email.length > 0 ? email : null;
}

async function fetchIdentities(api: AccountClient): Promise<UserIdentity[]> {
  if (!api.sessionOwner?.()) throw new Error('Требуется активная сессия аккаунта');
  const { data, error } = await api.auth.getUserIdentities();

  if (error) throw error;

  return data.identities;
}

export async function listIdentities(api = requestClient()): Promise<SignInIdentity[]> {
  const identities = await fetchIdentities(api);

  return identities.map((identity) => ({
    id: identity.identity_id,
    provider: identity.provider,
    email: emailOf(identity),
  }));
}

/**
 * Привязка второго способа входа по id-токену из нативного листа. На сервере
 * должна быть включена ручная привязка (Authentication → Allow manual linking).
 */
export async function linkIdentity(provider: IdentityProvider, token: string, api = requestClient()): Promise<void> {
  const owner = api.sessionOwner?.();
  await withSessionChange(async () => {
    if (!owner || !sameSession(owner, api.sessionOwner?.() ?? null)) throw new Error('Сессия аккаунта изменилась');
    const { error } = await api.auth.linkIdentity({ provider, token });
    if (error) throw error;
  });
}

/** Последний способ входа Auth отвязать не даст — и интерфейс такую кнопку не показывает. */
export async function unlinkIdentity(identityId: string, api = requestClient()): Promise<void> {
  const owner = api.sessionOwner?.();
  await withSessionChange(async () => {
    if (!owner || !sameSession(owner, api.sessionOwner?.() ?? null)) throw new Error('Сессия аккаунта изменилась');
    const identity = (await fetchIdentities(api)).find(item => item.identity_id === identityId);
    if (!identity) return;
    if (!sameSession(owner, api.sessionOwner?.() ?? null)) throw new Error('Сессия аккаунта изменилась');
    const { error } = await api.auth.unlinkIdentity(identity);
    if (error) throw error;
  });
}

export async function registerDevice(info: DeviceInfo, owner: SessionOwner, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('register_device', {
    p_installation_id: info.installationId,
    p_platform: info.platform,
    // Аргументы функций генератор типов считает обязательными строками:
    // «не знаем» уходит пустой строкой и обратно читается как null.
    p_model: info.model ?? '',
    p_os_version: info.osVersion ?? '',
    p_app_version: info.appVersion ?? '',
  }).setHeader('Authorization', await sessionAuthorization(owner, api));

  if (error) throw error;
}

/**
 * Отмечает активность и отвечает, жив ли ещё сеанс этого устройства. `false`
 * значит, что сеанс завершили с другого устройства или удалили аккаунт.
 */
export async function touchDevice(installationId: string, owner: SessionOwner, api = requestClient()): Promise<boolean> {
  const { data, error } = await api.rpc('touch_device', {
    p_installation_id: installationId,
  }).setHeader('Authorization', await sessionAuthorization(owner, api));

  if (error) throw error;

  return data;
}

/** Устройства, где сейчас выполнен вход. Своё текущее — тоже здесь. */
export async function listMyDevices(api = requestClient()): Promise<Device[]> {
  const { data, error } = await api
    .from('devices')
    .select(DEVICE_COLUMNS)
    .not('session_id', 'is', null)
    .is('signed_out_at', null)
    .order('last_seen_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(toDevice);
}

export async function endDeviceSession(deviceId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('end_device_session', { p_device_id: deviceId });

  if (error) throw error;
}

export async function endOtherSessions(api = requestClient()): Promise<void> {
  const { error } = await api.rpc('end_other_sessions');

  if (error) throw error;
}

export async function markDeviceSignedOut(installationId: string, owner: SessionOwner, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('mark_device_signed_out', {
    p_installation_id: installationId,
  }).setHeader('Authorization', await sessionAuthorization(owner, api));

  if (error) throw error;
}

/**
 * Выход только на этом устройстве. `signOut()` без аргумента по умолчанию
 * глобальный — он разлогинил бы и все остальные телефоны.
 *
 * Каналы Realtime закрываются до выхода: подписки открыты с токеном прежнего
 * пользователя, и следующий вход не должен их унаследовать.
 */
export async function signOutLocally(owner: SessionOwner): Promise<void> {
  await signOutAccount(owner.userId, owner);
}

export class DeleteAccountError extends Error {
  constructor(readonly cause?: unknown) {
    super('Не удалось удалить аккаунт');
    this.name = 'DeleteAccountError';
  }
}

/** Удаляет аккаунт вызывающего через Edge Function `delete-account`. */
export async function deleteMyAccount(owner: SessionOwner, api = requestClient()): Promise<void> {
  const { error } = await api.functions.invoke('delete-account', {
    method: 'POST',
    headers: { Authorization: await sessionAuthorization(owner, api) },
  });

  if (error) throw new DeleteAccountError(error);
}
