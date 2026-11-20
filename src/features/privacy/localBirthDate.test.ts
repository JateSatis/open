import AsyncStorage from '@react-native-async-storage/async-storage';

import { birthDateDecision, readLocalBirthDate, storeLocalBirthDate } from './localBirthDate';

const beforeBirthday = Date.parse('2026-11-19T09:59:59.999Z');
const birthday = Date.parse('2026-11-19T10:00:00Z');

beforeEach(() => AsyncStorage.clear());

it('пересчитывает возраст той же записи в полночь UTC+14, независимо от другого аккаунта', async () => {
  await storeLocalBirthDate('B', '2000-01-01');
  expect(birthDateDecision(await readLocalBirthDate('A'), birthday)).toBe('required');
  await storeLocalBirthDate('A', '2013-11-20');
  const record = await readLocalBirthDate('A');
  expect(birthDateDecision(record, beforeBirthday)).toBe('tooYoung');
  expect(birthDateDecision(record, birthday)).toBe('ok');
  expect(birthDateDecision(await readLocalBirthDate('B'), beforeBirthday)).toBe('ok');
});

it('для родившихся 29 февраля полные годы в невисокосный год наступают 1 марта', () => {
  const record = { date: '2012-02-29' };
  expect(birthDateDecision(record, Date.parse('2025-02-28T09:59:59Z'))).toBe('tooYoung');
  expect(birthDateDecision(record, Date.parse('2025-02-28T10:00:00Z'))).toBe('ok');
});

it.each(['broken', '2011-02-29', '2011-4-01', '0000-01-01', '2030-01-01', 'legacy'])(
  'повреждённая или будущая дата %s требует ввода даже со старой отметкой',
  async (value) => {
    await AsyncStorage.setItem('privacy.birthDateKnown.A', '1');
    await AsyncStorage.setItem('privacy.birthDate.A', value);
    expect(birthDateDecision(await readLocalBirthDate('A'), birthday)).toBe('required');
  },
);
