import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { USERNAME_CHECK_DELAY_MS } from './limits';

import { isUsernameAvailable } from '@/api/channels';
import { validateUsername } from '@/features/profile/username';

/**
 * Состояние имени в форме:
 * - `empty` — ничего не введено, подсказывать нечего;
 * - `invalid` — не подходит по формату, сервер не спрашиваем;
 * - `checking` — формат верный, ждём паузы в наборе или ответа сервера;
 * - `available` / `taken` — ответ сервера для ровно этого имени;
 * - `failed` — сервер не ответил: создать можно попробовать, он сам проверит.
 */
export type UsernameAvailability =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'taken' }
  | { status: 'failed' };

export const usernameAvailabilityKey = (username: string) =>
  ['username-available', username.toLowerCase()] as const;

/** Проверка `@имени` на лету: формат сразу, занятость — после паузы в наборе. */
export function useUsernameAvailability(value: string): UsernameAvailability {
  const username = value.trim();
  const formatError = username ? validateUsername(username) : null;
  const [settled, setSettled] = useState(username);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(username), USERNAME_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [username]);

  const query = useQuery({
    queryKey: usernameAvailabilityKey(settled),
    queryFn: () => isUsernameAvailable(settled),
    enabled: settled !== '' && settled === username && formatError === null,
    // Имя могут занять в любой момент: старый ответ не переиспользуем надолго.
    staleTime: 5_000,
    retry: false,
  });

  if (!username) return { status: 'empty' };
  if (formatError) return { status: 'invalid', message: formatError };
  if (settled !== username || query.isPending) return { status: 'checking' };
  if (query.isError) return { status: 'failed' };

  return query.data ? { status: 'available' } : { status: 'taken' };
}
