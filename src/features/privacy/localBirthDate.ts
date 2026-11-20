import AsyncStorage from '@react-native-async-storage/async-storage';

export type BirthDateDecision = 'required' | 'tooYoung' | 'ok';
export type LocalBirthDate =
  { date: string; confirmation?: { day: string; decision: 'ok' | 'tooYoung' } } | 'legacy' | null;

const dateKey = (userId: string) => `privacy.birthDate.${userId}`;
const UTC_PLUS_14_MS = 14 * 60 * 60 * 1000;

export function latestLocalDay(now = Date.now()): string {
  return new Date(now + UTC_PLUS_14_MS).toISOString().slice(0, 10);
}

export async function readLocalBirthDate(userId: string): Promise<LocalBirthDate> {
  try {
    const [[, date], [, known]] = await AsyncStorage.multiGet([
      dateKey(userId),
      `privacy.birthDateKnown.${userId}`,
    ]);
    if (date !== null) return { date };
    return known === '1' ? 'legacy' : null;
  } catch {
    return null;
  }
}

export async function storeLocalBirthDate(userId: string, date: string | null): Promise<void> {
  if (date === null) {
    await AsyncStorage.multiRemove([dateKey(userId), `privacy.birthDateKnown.${userId}`]);
  } else {
    await AsyncStorage.setItem(dateKey(userId), date);
  }
}

export function birthDateDecision(record: LocalBirthDate, now = Date.now()): BirthDateDecision {
  if (record === 'legacy') return 'ok';
  if (!record) return 'required';

  const { date } = record;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return 'required';
  const birth = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== date) {
    return 'required';
  }

  const today = latestLocalDay(now);
  // При расхождении часов в сеансе отправки действует только что полученный ответ RPC.
  if (record.confirmation?.day === today) return record.confirmation.decision;
  if (date > today) return 'required';
  const years = Number(today.slice(0, 4)) - birth.getUTCFullYear();
  const age = today.slice(5) < date.slice(5) ? years - 1 : years;
  return age < 13 ? 'tooYoung' : 'ok';
}
