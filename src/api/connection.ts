// Наблюдение за сокетом Realtime. Это единственный канал, который приложение
// держит открытым постоянно, поэтому именно он первым узнаёт и о пропаже
// связи, и о её возвращении — раньше любого запроса, который пользователь
// ещё не сделал.

import * as Network from 'expo-network';

import { supabase } from '@/api/supabase';

/**
 * Системное состояние сети. Оно приходит мгновенно, в отличие от собственных
 * проб, но говорит лишь о наличии подключения, а не о доступности сервера:
 * Wi-Fi без выхода наружу система считает связью.
 */
export function watchDeviceNetwork(onChange: (connected: boolean) => void): () => void {
  const subscription = Network.addNetworkStateListener(({ isConnected }) => {
    onChange(isConnected === true);
  });

  void Network.getNetworkStateAsync()
    .then(({ isConnected }) => onChange(isConnected === true))
    .catch(() => onChange(true));

  return () => subscription.remove();
}

/** Держится ли сейчас сокет Realtime. Ответ бесплатный — состояние локальное. */
export function isRealtimeConnected(): boolean {
  return supabase.realtime.isConnected();
}

/**
 * Достучаться до сервера самым дешёвым запросом. Нужен, когда сокета нет:
 * иначе приложение не отличит «сеть пропала» от «ещё подключаемся» и не узнает
 * о возвращении связи, пока пользователь сам что-нибудь не запросит.
 */
// Запас на первый запрос после возвращения сети: он уходит в ещё не
// прогретый стек и отвечает заметно медленнее обычного. Слишком короткий
// таймаут обрывал именно ту попытку, которая должна была сказать «связь есть».
const PROBE_TIMEOUT_MS = 5000;

export async function probeServer(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return false;

  // Без таймаута проба может висеть десятки секунд: сразу после возвращения
  // сети запрос уходит в ещё не поднявшийся стек и молчит, а приложение всё
  // это время думает, что сети нет.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/auth/v1/health?t=${Date.now()}`, {
      headers: { apikey: key },
      signal: abort.signal,
      cache: 'no-store',
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type RealtimeConnectionState = 'joined' | 'down';

/**
 * Поднять сокет немедленно, не дожидаясь очередной попытки клиента: после
 * возвращения сети он переподключается с нарастающими паузами и может
 * молчать ещё десяток секунд, хотя связь уже есть.
 */
export function reconnectRealtime() {
  if (supabase.realtime.isConnected()) return;

  supabase.realtime.connect();
}

/**
 * Пульс соединения. Клиент сам переподключается с нарастающими паузами, а
 * колбэк сообщает, чем закончилась очередная попытка.
 */
export function watchRealtimeConnection(
  onChange: (state: RealtimeConnectionState) => void,
): () => void {
  let stopped = false;

  supabase.realtime.onHeartbeat((status) => {
    if (stopped) return;

    if (status === 'ok') {
      onChange('joined');
      return;
    }

    if (status === 'error' || status === 'timeout' || status === 'disconnected') {
      onChange('down');
    }
  });

  // Пульс приходит раз в несколько секунд, а знать состояние надо сразу после
  // запуска — иначе экран до первого удара показывает «подключение».
  onChange(supabase.realtime.isConnected() ? 'joined' : 'down');

  return () => {
    stopped = true;
  };
}
