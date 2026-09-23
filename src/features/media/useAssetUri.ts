import { useEffect, useState } from 'react';

import { cachedAssetUri, loadAssetUri } from './assetUriCache';

/**
 * `uri` файла для клетки грида. Сам путь берётся из общего кэша
 * (`assetUriCache`): его прогревает загрузка страницы, а клетка лишь
 * подхватывает готовое либо ждёт того же самого запроса.
 */
export function useAssetUri(id: string): string | null {
  const [resolvedForId, setResolvedForId] = useState(id);
  const [uri, setUri] = useState<string | null>(() => cachedAssetUri(id));

  // Клетка переиспользована FlatList'ом под другой файл — подстраиваем
  // состояние прямо в рендере, а не эффектом: это подгонка состояния под
  // изменившийся проп, а не синхронизация с внешней системой.
  if (id !== resolvedForId) {
    setResolvedForId(id);
    setUri(cachedAssetUri(id));
  }

  useEffect(() => {
    const cached = cachedAssetUri(id);

    if (cached !== null) return;

    let cancelled = false;

    loadAssetUri(id)
      .then((resolved) => {
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
