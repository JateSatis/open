import { resolveAssetUri, type LibraryAsset, type ResolvedLibraryAsset } from './mediaLibrary';

/**
 * Общий кэш `uri` файлов галереи. Живёт на модуле, а не в компоненте: клетки
 * грида FlatList переиспользует, и без общего кэша один и тот же файл
 * резолвился бы заново при каждом возврате в зону видимости.
 *
 * Здесь же дедупликация запросов: клетка и фоновый прогрев страницы просят
 * один и тот же файл почти одновременно, а поход в медиатеку дорогой.
 */
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/**
 * Сколько файлов резолвим параллельно при прогреве. Каждый запрос — поход в
 * медиатеку, но асинхронный: восемь в полёте заметно опережают быстрый скролл
 * и всё ещё не занимают главный поток целиком.
 */
const WARM_CONCURRENCY = 8;

export function cachedAssetUri(id: string): string | null {
  return cache.get(id) ?? null;
}

export function loadAssetUri(id: string): Promise<string> {
  const cached = cache.get(id);

  if (cached !== undefined) return Promise.resolve(cached);

  const pending = inFlight.get(id);

  if (pending) return pending;

  const request = resolveAssetUri(id)
    .then((uri) => {
      cache.set(id, uri);

      return uri;
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, request);

  return request;
}

/**
 * Прогревает кэш для только что загруженной страницы грида: к моменту, когда
 * клетка доедет до экрана, её `uri` уже есть, и превью появляется сразу, а не
 * «доезжает» следом за скроллом. Ошибки глушатся — файл могли удалить из
 * галереи, это не повод ронять прогрев остальных.
 */
export function warmAssetUris(ids: string[]): void {
  let next = 0;

  const pump = (): Promise<void> => {
    const id = ids[next++];

    if (id === undefined) return Promise.resolve();

    return loadAssetUri(id)
      .catch(() => undefined)
      .then(pump);
  };

  for (let worker = 0; worker < WARM_CONCURRENCY; worker++) {
    void pump();
  }
}

/**
 * Путь к файлу к моменту, когда он реально нужен — при отправке. Выбор в
 * гриде кладёт в черновик `uri: null`, если путь ещё не прогрелся, и эта
 * функция добирает его перед загрузкой байт.
 */
export async function resolveLibraryAsset(asset: LibraryAsset): Promise<ResolvedLibraryAsset> {
  if (asset.uri !== null) return { ...asset, uri: asset.uri };

  return { ...asset, uri: await loadAssetUri(asset.id) };
}

/** Только для тестов: кэш на модуле переживает перемонтирование компонентов. */
export function resetAssetUriCache(): void {
  cache.clear();
  inFlight.clear();
}
