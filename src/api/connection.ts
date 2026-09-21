// Наблюдение за сокетом Realtime. Это единственный канал, который приложение
// держит открытым постоянно, поэтому именно он первым узнаёт и о пропаже
// связи, и о её возвращении — раньше любого запроса, который пользователь
// ещё не сделал.

import { supabase } from '@/api/supabase';

/** Держится ли сейчас сокет Realtime. Ответ бесплатный — состояние локальное. */
export function isRealtimeConnected(): boolean {
  return supabase.realtime.isConnected();
}

/**
 * Достучаться до сервера самым дешёвым запросом. Нужен, когда сокета нет:
 * иначе приложение не отличит «сеть пропала» от «ещё подключаемся» и не узнает
 * о возвращении связи, пока пользователь сам что-нибудь не запросит.
 */
export async function probeServer(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return false;

  try {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });

    return response.ok;
  } catch {
    return false;
  }
}

export type RealtimeConnectionState = 'joined' | 'down';

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
