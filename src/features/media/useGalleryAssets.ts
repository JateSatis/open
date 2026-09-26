import { useCallback, useEffect, useRef, useState } from 'react';

import { MediaLimits } from './constants';
import { getGallerySnapshot, setGallerySnapshot } from './galleryPrefetch';
import {
  countRecentMedia,
  queryRecentMedia,
  requestMediaLibraryAccess,
  type MediaLibraryItem,
} from './mediaLibrary';
import { perfLog } from './perf';

/**
 * Состояния разделены намеренно и полностью.
 *
 * Раньше их было три (`checking` / `granted` / `denied`), и «читаю галерею»
 * ничем не отличалось от «галерея пуста»: разрешение уже выдано, статус уже
 * `granted`, а `items` ещё пустой — и грид показывал «На устройстве нет фото
 * и видео» на те доли секунды, пока идёт первый запрос к медиатеке. Надпись
 * про пустую галерею имеет право появиться ровно в одном состоянии — `empty`,
 * то есть когда медиатека ответила и ответила ничем.
 */
export type GalleryStatus = 'checking' | 'denied' | 'loading' | 'empty' | 'ready';

export type GalleryAssets = {
  status: GalleryStatus;
  items: MediaLibraryItem[];
  /**
   * Сколько файлов в галерее всего. Приходит раньше самих файлов и нужен
   * скелету: столько клеток он рисует, пока настоящих ещё нет. `null` —
   * счётчик пока неизвестен или не дался.
   */
  total: number | null;
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
 * список вычитывается вперёд: дальше длина списка соответствует всей
 * галерее, скроллбар честный, а прыжок в любую точку ничего не ждёт.
 *
 * Метаданные дёшевы (`exeForMetadata` читает индекс медиатеки, а не файлы), а
 * превью грузит сам `expo-image` по мере появления клеток на экране — никакого
 * своего прогрева и кэша путей больше нет.
 */
export function useGalleryAssets(enabled: boolean): GalleryAssets {
  // Начало галереи могли прочитать заранее — см. `prefetchGallery`. Тогда
  // грид с первого кадра показывает настоящие клетки, а полное чтение ниже
  // только освежает их.
  const [initial] = useState(getGallerySnapshot);
  const [status, setStatus] = useState<GalleryStatus>(
    initial ? (initial.items.length > 0 ? 'ready' : 'empty') : 'checking',
  );
  const [items, setItems] = useState<MediaLibraryItem[]>(initial?.items ?? []);
  const [total, setTotal] = useState<number | null>(initial?.total ?? null);
  const [isFilling, setIsFilling] = useState(false);
  const cancelledRef = useRef(false);

  const fill = useCallback(async () => {
    // Прогретые клетки уже на экране — «читаю» им не нужно.
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setIsFilling(true);

    // Счётчик идёт параллельно первому куску, а не перед ним: он нужен
    // скелету, а не файлам, и задерживать из-за него появление настоящих
    // клеток незачем.
    void countRecentMedia().then((count) => {
      if (!cancelledRef.current && count !== null) setTotal(count);
    });

    try {
      // Первый кусок маленький: он нужен прямо сейчас, чтобы на экране
      // появились настоящие клетки, а не пустая сетка.
      const head = await queryRecentMedia({ offset: 0, limit: MediaLimits.gallery.firstChunk });

      if (cancelledRef.current) return;

      perfLog('галерея: первый кусок', { got: head.length });
      setItems(head);
      setStatus(head.length === 0 ? 'empty' : 'ready');

      if (head.length < MediaLimits.gallery.firstChunk) {
        // Галерея кончилась на первом же куске — вот теперь её длина
        // известна точно, и счётчику верить больше незачем.
        setTotal(head.length);
        setGallerySnapshot({ items: head, total: head.length });
        return;
      }

      // Остальное — одним запросом, а не кусками. Куски выглядели мягче, но
      // каждый из них пересоздавал массив и перерисовывал весь список, и эти
      // перерисовки приходились ровно на то время, когда человек уже
      // скроллит. Один запрос и одна перерисовка: по замеру вся галерея
      // (3345 файлов) читается за ~1.1 с против ~2.3 с кусками по 600.
      const all = await queryRecentMedia({ offset: 0, limit: MediaLimits.gallery.maxAssets });

      if (cancelledRef.current) return;

      perfLog('галерея: дочитана', { total: all.length });
      setItems(all);
      setTotal(all.length);
      setGallerySnapshot({ items: all, total: all.length });
    } finally {
      if (!cancelledRef.current) setIsFilling(false);
    }
  }, []);

  // Статус здесь не сбрасывается в `checking` намеренно: до ответа системы
  // менять нечего, а синхронный setState в эффекте — это лишний каскад
  // рендеров ровно в тот момент, когда шит открывается.
  const requestAccess = useCallback(() => {
    void requestMediaLibraryAccess().then((access) => {
      if (cancelledRef.current) return;

      if (access === 'denied') {
        setStatus('denied');
        return;
      }

      void fill();
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

  return { status, items, total, isFilling, requestAccess };
}
