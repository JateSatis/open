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

export function useLocalBirthDateDecision(userId: string | null | undefined) {
  const local = useQuery({
    queryKey: localKey(userId),
    queryFn: () => (userId ? readLocalBirthDate(userId) : null),
    enabled: Boolean(userId),
    networkMode: 'always',
    staleTime: Infinity,
    refetchOnReconnect: false,
  });
  if (local.isPending) return 'loading';
  return birthDateDecision(local.data ?? null);
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
