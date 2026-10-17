import { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

import type { TileRect } from '@/features/media/tileRegistry';

/**
 * Взведённое окно, которое так и не открыли, убирается само. Тап дольше не
 * бывает: дальше это уже долгое нажатие, и жест сам скажет «тапа не будет».
 * Страховка — на случай, если не скажет: невидимое окно перекрывало бы экран.
 */
const ARMED_LIMIT_MS = 1000;

export type ViewerLaunch = {
  /** С какого файла открыт просмотр. */
  index: number;
  /** Где на экране его плитка. */
  origin: TileRect | null;
  /** Палец ещё на плитке: окно готовится, медиа стоит в плитке. */
  armed: boolean;
};

/**
 * Состояние просмотра у того, кто его открывает: взведён под пальцем,
 * открыт, закрыт. Взвод другой плитки, чем та, по которой тапнули, — это
 * другой просмотр: `MediaViewer` с `key` по номеру рождается заново.
 */
export function useArmedViewer() {
  const [viewer, setViewer] = useState<ViewerLaunch | null>(null);

  const open = useCallback(
    (index: number, origin: TileRect | null) =>
      setViewer((current) =>
        current === null || current.armed ? { index, origin, armed: false } : current,
      ),
    [],
  );
  // С открытой клавиатурой окно заранее не готовится: новое окно забрало бы
  // фокус у поля ввода, даже если касание окажется началом прокрутки.
  const arm = useCallback((index: number, origin: TileRect | null) => {
    if (Keyboard.isVisible()) return;

    setViewer((current) => current ?? { index, origin, armed: true });
  }, []);
  const disarm = useCallback(() => setViewer((current) => (current?.armed ? null : current)), []);
  const close = useCallback(() => setViewer(null), []);

  const armed = viewer?.armed ?? false;

  useEffect(() => {
    if (!armed) return;

    const limit = setTimeout(disarm, ARMED_LIMIT_MS);

    return () => clearTimeout(limit);
  }, [armed, disarm]);

  return { viewer, open, arm, disarm, close };
}
