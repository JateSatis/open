import { type QueryClient, useQuery } from '@tanstack/react-query';

import {
  birthDateDecision,
  latestLocalDay,
  readLocalBirthDate,
  storeLocalBirthDate,
  type LocalBirthDate,
} from './localBirthDate';

const localKey = (userId: string | null | undefined) =>
  ['privacy', 'localBirthDate', userId] as const;

function localBirthDateOptions(userId: string | null | undefined) {
  return {
    queryKey: localKey(userId),
    queryFn: () => (userId ? readLocalBirthDate(userId) : null),
    enabled: Boolean(userId),
    networkMode: 'always' as const,
    staleTime: Infinity,
    refetchOnReconnect: false,
  };
}

export function useLocalBirthDateDecision(userId: string | null | undefined) {
  const local = useQuery(localBirthDateOptions(userId));
  if (local.isPending) return 'loading';
  return birthDateDecision(local.data ?? null);
}

export async function reconcileMissingBirthDate(client: QueryClient, userId: string, isCurrent: () => boolean) {
  const local = await client.ensureQueryData(localBirthDateOptions(userId));
  // Сервер не хранит отклонённую дату младше 13 лет. Пустое поле
  // отзывает только локальный допуск, сохраняя экран ограничения.
  if (!isCurrent() || birthDateDecision(local) !== 'ok') return;
  client.setQueryData(localKey(userId), null);
  try {
    await storeLocalBirthDate(userId, null);
  } catch {
    // В открытом приложении уточнение уже действует.
  }
}

export async function rememberBirthDate(
  client: QueryClient,
  userId: string,
  date: string,
  decisionAtSave?: 'ok' | 'tooYoung',
) {
  const queryKey = localKey(userId);
  // Незавершённое чтение с диска не должно вернуть прежнюю дату поверх ответа RPC.
  void client.cancelQueries({ queryKey });
  client.setQueryData<LocalBirthDate>(queryKey, (previous) => {
    if (decisionAtSave)
      return { date, confirmation: { day: latestLocalDay(), decision: decisionAtSave } };
    if (previous && previous !== 'legacy' && previous.date === date) return previous;
    return { date };
  });
  try {
    await storeLocalBirthDate(userId, date);
  } catch {
    // Для текущего сеанса ответ сервера действует и при недоступном хранилище.
  }
}
