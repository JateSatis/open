import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

import type { Pop } from '@/api/pops';
import type { JournalSurface } from '@/features/recs/journal/journal';
import { beginPopImpression, endPopImpression, notePopExit } from '@/features/recs/journal/popJournal';

/**
 * Показы попсов в журнале. Показ идёт, пока поп — активная страница, экран
 * наверху и приложение на переднем плане. Сменилась страница — конец показа
 * с направлением свайпа и начало нового; ушли в фон — конец `background`,
 * вернулись — новый показ; экран закрыт или перекрыт — конец по причине,
 * которую заранее отметили (канал, «назад»), иначе `navigate`.
 */
export function usePopJournal({
  pops,
  activeIndex,
  focused,
  appActive,
  surface,
  entry,
}: {
  pops: Pop[];
  activeIndex: number;
  focused: boolean;
  appActive: boolean;
  surface: JournalSurface;
  entry: string;
}) {
  const active = pops[activeIndex] ?? null;
  const shown = useRef<{ id: string; index: number } | null>(null);
  const entryRef = useRef(entry);
  const navigation = useNavigation();

  // Экран закрывают («назад», жест) — фокус он теряет раньше, чем размонтируется.
  useEffect(() => navigation.addListener('beforeRemove', () => notePopExit('close')), [navigation]);

  useEffect(() => {
    const live = focused && appActive && active !== null;
    const prev = shown.current;

    if (!live) {
      if (prev) {
        endPopImpression(appActive ? 'navigate' : 'background');
        shown.current = null;
      }
      return;
    }

    if (prev?.id === active.id) return;

    if (prev) endPopImpression(activeIndex >= prev.index ? 'swipe_next' : 'swipe_prev');

    beginPopImpression({
      popId: active.id,
      durationMs: active.durationMs,
      surface,
      // Первый показ — с той точки, откуда пришли; дальше — листанием.
      entry: prev ? 'swipe' : entryRef.current,
    });
    entryRef.current = 'resume';
    shown.current = { id: active.id, index: activeIndex };
  }, [active, activeIndex, appActive, focused, surface]);

  useEffect(
    () => () => {
      if (shown.current) endPopImpression('close');
      shown.current = null;
    },
    [],
  );
}
