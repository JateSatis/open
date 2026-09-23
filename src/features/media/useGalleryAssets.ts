import { useCallback, useEffect, useRef, useState } from 'react';

import { MediaLimits } from './constants';
import { queryRecentMedia, requestMediaLibraryAccess, type MediaLibraryItem } from './mediaLibrary';
import { perfLog } from './perf';

export type GalleryStatus = 'checking' | 'granted' | 'denied';

export type GalleryAssets = {
  status: GalleryStatus;
  items: MediaLibraryItem[];
  /** Дочитывается ли ещё хвост галереи — нужно только для индикатора. */
  isFilling: boolean;
  requestAccess: () => void;
};

/**
 * Список файлов галереи для грида выбора.
 *
 * Здесь нет постраничной подгрузки «по достижении конца», и это намеренно:
 * замер показал, что запрос метаданных не дорожает с глубиной (страница на
 * offset 3000 отвечает за 48 мс против 106 мс на offset 100), а дорого —
 * ждать её в тот момент, когда палец уже доскроллил до конца. Поэтому весь
 * список вычитывается вперёд, кусками, пока человек смотрит на первый экран:
 * дальше длина списка соответствует всей галерее, скроллбар честный, а
 * прыжок в любую точку ничего не ждёт.
 *
 * Метаданные дёшевы (`exeForMetadata` читает индекс медиатеки, а не файлы), а
 * превью грузит сам `expo-image` по мере появления клеток на экране — никакого
 * своего прогрева и кэша путей больше нет.
 */
export function useGalleryAssets(enabled: boolean): GalleryAssets {
  const [status, setStatus] = useState<GalleryStatus>('checking');
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [isFilling, setIsFilling] = useState(false);
  const cancelledRef = useRef(false);

  const fill = useCallback(async () => {
    setIsFilling(true);

    try {
      // Первый кусок маленький: он нужен прямо сейчас, чтобы на экране
      // появились настоящие клетки, а не пустая сетка.
      const head = await queryRecentMedia({ offset: 0, limit: MediaLimits.gallery.firstChunk });

      if (cancelledRef.current) return;

      perfLog('галерея: первый кусок', { got: head.length });
      setItems(head);

      if (head.length < MediaLimits.gallery.firstChunk) return;

      // Хвост вычитывается кусками, а не одним запросом на всю галерею:
      // целиком это около секунды, и весь этот срок список не обновлялся бы
      // вовсе. Кусками он растёт на глазах и не занимает поток надолго.
      let offset = head.length;
      const rest: MediaLibraryItem[] = [];

      while (offset < MediaLimits.gallery.maxAssets) {
        const chunk = await queryRecentMedia({
          offset,
          limit: MediaLimits.gallery.chunk,
        });

        if (cancelledRef.current) return;
        if (chunk.length === 0) break;

        rest.push(...chunk);
        offset += chunk.length;
        setItems([...head, ...rest]);

        if (chunk.length < MediaLimits.gallery.chunk) break;
      }

      perfLog('галерея: дочитана', { total: head.length + rest.length });
    } finally {
      if (!cancelledRef.current) setIsFilling(false);
    }
  }, []);

  const requestAccess = useCallback(() => {
    void requestMediaLibraryAccess().then((access) => {
      if (cancelledRef.current) return;

      setStatus(access);
      if (access === 'granted') void fill();
    });
  }, [fill]);

  useEffect(() => {
    if (!enabled) return;

    cancelledRef.current = false;
    requestAccess();

    return () => {
      cancelledRef.current = true;
    };
  }, [enabled, requestAccess]);

  return { status, items, isFilling, requestAccess };
}
