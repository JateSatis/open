import { useEffect, useState } from 'react';

import { resolveAssetUri } from './mediaLibrary';

/**
 * `uri` файла для клетки грида — резолвится лениво, только когда клетка
 * реально отрисовалась, и кэшируется на модуле по тем же причинам, что и
 * `useVideoThumbnail`: FlatList пересоздаёт клетки при скролле, и без общего
 * кэша один и тот же файл резолвился бы заново при каждом возврате в зону
 * видимости.
 */
const cache = new Map<string, string>();

export function useAssetUri(id: string): string | null {
  const [resolvedForId, setResolvedForId] = useState(id);
  const [uri, setUri] = useState<string | null>(() => cache.get(id) ?? null);

  if (id !== resolvedForId) {
    setResolvedForId(id);
    setUri(cache.get(id) ?? null);
  }

  useEffect(() => {
    if (cache.has(id)) return;

    let cancelled = false;

    resolveAssetUri(id)
      .then((resolved) => {
        cache.set(id, resolved);
        if (!cancelled) setUri(resolved);
      })
      .catch(() => {
        // Файл могли удалить из галереи между запросом страницы и рендером
        // клетки — клетка останется скелетоном, а не сломает весь грид.
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return uri;
}
