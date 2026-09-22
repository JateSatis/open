import { getThumbnailAsync } from 'expo-video-thumbnails';
import { useEffect, useState } from 'react';

/**
 * Кадр из видео для клетки грида: `expo-image` умеет показывать фото прямо
 * по `uri` файла, но не умеет декодировать видео как картинку — нужен
 * отдельный статичный кадр.
 *
 * Кэш на модуле, а не на компоненте: клетки грида пересоздаются при
 * скролле (FlatList их переиспользует и размонтирует), и без общего кэша
 * один и тот же ролик был бы сфотографирован заново при каждом возврате в
 * зону видимости.
 */
const cache = new Map<string, string>();

export function useVideoThumbnail(uri: string): string | null {
  const [resolvedForUri, setResolvedForUri] = useState(uri);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => cache.get(uri) ?? null);

  // Клетка грида переиспользуется FlatList'ом под другой файл — если кадр
  // на этот uri уже есть в кэше, подстраиваем состояние прямо в рендере, а
  // не эффектом: это тот самый случай, когда одно состояние подгоняется
  // под изменившийся проп, а не синхронизируется с внешней системой.
  if (uri !== resolvedForUri) {
    setResolvedForUri(uri);
    setThumbnailUri(cache.get(uri) ?? null);
  }

  useEffect(() => {
    if (cache.has(uri)) return;

    let cancelled = false;

    getThumbnailAsync(uri, { time: 0, quality: 0.3 })
      .then((result) => {
        cache.set(uri, result.uri);
        if (!cancelled) setThumbnailUri(result.uri);
      })
      .catch(() => {
        // Не удалось снять кадр (повреждённый файл, незнакомый кодек) —
        // клетка покажет заглушку по kind, а не сломает весь грид.
      });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return thumbnailUri;
}
