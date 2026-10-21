import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useBirthDateGate } from '@/features/privacy/queries';

/** Маршруты, где ворота не нужны: вход и сам экран даты. */
const OPEN_SEGMENTS = new Set(['(auth)', 'birth-date']);

/**
 * Ничего не рисует. Вошедший без даты рождения попадает на экран даты, куда
 * бы ни вела его ссылка: вкладки ждут ответа сами (`(tabs)/_layout`), а
 * этот страж ловит остальные корневые маршруты — канал, попсы, звонок.
 */
export function BirthDateGate() {
  const gate = useBirthDateGate();
  const segments = useSegments();
  const router = useRouter();
  const top = segments[0] ?? '';

  useEffect(() => {
    if (gate === 'required' && !OPEN_SEGMENTS.has(top)) router.replace('/birth-date');
  }, [gate, top, router]);

  return null;
}
