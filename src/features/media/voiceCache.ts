import { requestClient } from '@/api/requestClient';
import { Directory, File, Paths } from 'expo-file-system';

import { isChatMediaPath, signChatMediaUrl } from '@/api/chatMedia';

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

function directoryFor(url: string, api: ReturnType<typeof requestClient>) {
  if (!isChatMediaPath(url)) return new Directory(Paths.cache, VOICE_DIR);
  if (api.retired) throw new Error('Сессия аккаунта изменилась');
  const sessionId = api.localSessionId ?? api.sessionOwner?.()?.sessionId;
  if (api.sessionOwner && !sessionId) throw new Error('Нет сохранённой сессии аккаунта');
  return new Directory(Paths.cache, VOICE_DIR, 'session-' + encodeURIComponent(sessionId ?? 'anonymous'));
}

function cacheFileFor(url: string, api: ReturnType<typeof requestClient>): File {
  return new File(directoryFor(url, api), `${hashUrl(url)}-${url.length}.${extensionOf(url)}`);
}

/** Файл уже на устройстве — без обращения к сети. Для локальных `file://` всегда да. */
export function cachedVoiceUri(url: string, api = requestClient()): string | null {
  if (url.startsWith('file://')) return url;

  try {
    const file = cacheFileFor(url, api);

    return file.exists && file.size > 0 ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Локальный путь к голосовому: из кеша или после загрузки. Скачивается во
 * временное имя и переименовывается по готовности, чтобы оборванная загрузка
 * не выдавалась потом за готовый файл.
 *
 * `url` — путь в закрытом `chat-media` (кеш — по пути, скачивается по
 * подписанной ссылке) или адрес. Ссылку не дали — голосовое скрыто или нет
 * сети: ошибка, плеер покажет «не удалось».
 */
export async function resolveVoiceUri(url: string, api = requestClient()): Promise<string> {
  const cached = cachedVoiceUri(url, api);

  if (cached) return cached;

  const key = cacheFileFor(url, api).uri;
  const running = inFlight.get(key);

  if (running) return running;

  const download = (async () => {
    const directory = directoryFor(url, api);

    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

    const target = cacheFileFor(url, api);
    const partial = new File(directory, `${target.name}.part`);
    const source = isChatMediaPath(url) ? await signChatMediaUrl(url, api) : url;

    if (!source) throw new Error('Voice is not available');

    const downloaded = await File.downloadFileAsync(source, partial, { idempotent: true });

    downloaded.move(target);

    return target.uri;
  })();

  inFlight.set(key, download);

  try {
    return await download;
  } finally {
    inFlight.delete(key);
  }
}
