import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { isUsernameAvailable, type UsernameKind } from '@/api/usernames';
import { USERNAME_CHECK_DELAY_MS, validateUsername } from '@/features/profile/username';

/**
 * Состояние имени в форме:
 * - `empty` — ничего не введено, подсказывать нечего;
 * - `unchanged` — то же, что уже стоит у сущности: спрашивать незачем;
 * - `invalid` — не подходит по формату, сервер не спрашиваем;
 * - `checking` — формат верный, ждём паузы в наборе или ответа сервера;
 * - `available` / `taken` — ответ сервера для ровно этого имени;
 * - `failed` — сервер не ответил: сохранить можно попробовать, он сам проверит.
 */
export type UsernameAvailability =
  | { status: 'empty' }
  | { status: 'unchanged' }
  | { status: 'invalid'; message: string }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'taken' }
  | { status: 'failed' };

export type UsernameAvailabilityOptions = {
  kind: UsernameKind;
  /** Редактируемая сущность — у группы и канала; у профиля это всегда я. */
  ownId?: string;
  /** Имя, которое уже стоит: его ввод — не новое имя. */
  current?: string | null;
};

// Ответ зависит и от того, чьё имя редактируют: своё имя занятым не считается.
export const usernameAvailabilityKey = (kind: UsernameKind, username: string, ownId?: string) =>
  ['username-available', kind, username.toLowerCase(), ownId ?? null] as const;

/**
 * Проверка `@имени` на лету в пространстве своего вида: формат сразу,
 * занятость — после паузы в наборе.
 */
export function useUsernameAvailability(
  value: string,
  { kind, ownId, current }: UsernameAvailabilityOptions,
): UsernameAvailability {
  const api = useRequestClient();
  const username = value.trim();
  const formatError = username ? validateUsername(username) : null;
  const unchanged = !!current && username.toLowerCase() === current.toLowerCase();
  const [settled, setSettled] = useState(username);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(username), USERNAME_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [username]);

  const query = useQuery({
    queryKey: usernameAvailabilityKey(kind, settled, ownId),
    queryFn: () => isUsernameAvailable(kind, settled, ownId, api),
    enabled: settled !== '' && settled === username && formatError === null && !unchanged,
    // Имя могут занять в любой момент: старый ответ не переиспользуем надолго.
    staleTime: 5_000,
    retry: false,
  });

  if (!username) return { status: 'empty' };
  if (formatError) return { status: 'invalid', message: formatError };
  if (unchanged) return { status: 'unchanged' };
  if (settled !== username || query.isPending) return { status: 'checking' };
  if (query.isError) return { status: 'failed' };

  return query.data ? { status: 'available' } : { status: 'taken' };
}
