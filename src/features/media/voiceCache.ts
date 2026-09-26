import { Directory, File, Paths } from 'expo-file-system';

/**
 * Голосовые, скачанные один раз, лежат в кеше приложения и при повторном
 * прослушивании берутся оттуда: трафик публичного мессенджера — базовое
 * требование, а не оптимизация. Кеш, а не документы: система может его
 * почистить, и тогда файл просто скачается снова.
 */
const VOICE_DIR = 'voice';

/** Одна загрузка на URL: два быстрых тапа не качают файл дважды. */
const inFlight = new Map<string, Promise<string>>();

/** Короткий стабильный хеш URL — имя файла в кеше. */
function hashUrl(url: string): string {
  let hash = 5381;

  for (let index = 0; index < url.length; index += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(36);
}

function extensionOf(url: string): string {
  const match = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url);

  return match ? match[1].toLowerCase() : 'm4a';
}

function cacheFileFor(url: string): File {
  return new File(Paths.cache, VOICE_DIR, `${hashUrl(url)}-${url.length}.${extensionOf(url)}`);
}

/** Файл уже на устройстве — без обращения к сети. Для локальных `file://` всегда да. */
export function cachedVoiceUri(url: string): string | null {
  if (url.startsWith('file://')) return url;

  try {
    const file = cacheFileFor(url);

    return file.exists && file.size > 0 ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Локальный путь к голосовому: из кеша или после загрузки. Скачивается во
 * временное имя и переименовывается по готовности, чтобы оборванная загрузка
 * не выдавалась потом за готовый файл.
 */
export async function resolveVoiceUri(url: string): Promise<string> {
  const cached = cachedVoiceUri(url);

  if (cached) return cached;

  const running = inFlight.get(url);

  if (running) return running;

  const download = (async () => {
    const directory = new Directory(Paths.cache, VOICE_DIR);

    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

    const target = cacheFileFor(url);
    const partial = new File(directory, `${target.name}.part`);
    const downloaded = await File.downloadFileAsync(url, partial, { idempotent: true });

    downloaded.move(target);

    return target.uri;
  })();

  inFlight.set(url, download);

  try {
    return await download;
  } finally {
    inFlight.delete(url);
  }
}
