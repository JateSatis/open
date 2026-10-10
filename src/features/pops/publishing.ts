// Публикация попа из редактора: плитка «в пути» появляется в сетке канала
// сразу, загрузка и вызов функции идут вне экрана — редактор к этому
// моменту уже закрыт. Плитки «в пути» — клиентское состояние, как исходящие
// сообщения (`outbox.ts`): в кеш запросов поп попадает только с ответом базы.

import type { QueryClient } from '@tanstack/react-query';

import { NO_POP_REACTIONS, publishPop, type Pop } from '@/api/pops';
import { chatsQueryKey } from '@/features/chats/useChats';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import { MediaUploadError, removeUploadedMedia, storedPaths } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { popsQueryKey, type PopsPages } from '@/features/pops/queries';
import { DeadlineError, withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';
import { randomUuid } from '@/lib/uuid';

import { PopPosterError, toPopMedia, uploadPop } from './uploadPop';

import { find, patch, setChannel, type NewPop } from './pendingPops';

export { usePendingPops, type NewPop, type PendingPop } from './pendingPops';

/** Дольше этого загрузку и публикацию не ждём — дальше это потеря связи. */
const PUBLISH_DEADLINE_MS = 60_000;

const running = new Set<string>();

/** Отказ, который повтор сам не исправит, — человеческим текстом. Обрыв связи виден и так. */
function explain(cause: unknown) {
  if (cause instanceof PopPosterError) {
    showNotice('Не удалось снять обложку видео. Повторите или выберите другое.', 'error');
  } else if (cause instanceof MediaUploadError) {
    showNotice('Не удалось загрузить видео. Попробуйте ещё раз.', 'error');
  } else if (!(cause instanceof DeadlineError) && !isNetworkError(cause)) {
    showNotice('Не удалось опубликовать поп. Попробуйте ещё раз.', 'error');
  }
}

async function run(queryClient: QueryClient, userId: string, channelId: string, localId: string) {
  const pending = find(channelId, localId);

  if (!pending || running.has(localId)) return;

  running.add(localId);
  patch(channelId, localId, { status: 'publishing' });

  let uploaded = pending.uploaded;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requested = false;

  try {
    if (!uploaded) {
      // Без связи загрузка висит, а не падает: срок превращает её в ошибку.
      // Файл, доехавший после срока, убирается — повтор зальёт свой.
      uploaded = await withDeadline(
        uploadPop(pending.media, userId),
        PUBLISH_DEADLINE_MS,
        (late) => {
          void removeUploadedMedia(storedPaths(late));
        },
      );
      patch(channelId, localId, { uploaded });
    }

    timer = setTimeout(() => abort.abort(), PUBLISH_DEADLINE_MS);

    const media = toPopMedia(uploaded, pending.media);

    requested = true;
    await publishPop(
      {
        channelId,
        popId: pending.popId,
        media,
        caption: pending.caption,
        alsoPost: pending.alsoPost,
        postText: pending.alsoPost ? pending.caption : null,
      },
      abort.signal,
    );

    const pop: Pop = {
      id: pending.popId,
      channelId,
      authorId: userId,
      caption: pending.caption,
      url: media.url,
      posterUrl: media.posterUrl,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      createdAt: new Date().toISOString(),
      reactions: NO_POP_REACTIONS,
      viewsCount: 0,
    };

    // Опубликованный встаёт первой плиткой сразу, без ожидания перечитывания:
    // плитка «в пути» уходит в том же проходе, без мигания.
    queryClient.setQueryData<PopsPages>(popsQueryKey(channelId), (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page, index) =>
              index === 0 ? [pop, ...page.filter((item) => item.id !== pop.id)] : page,
            ),
          }
        : data,
    );
    setChannel(channelId, (pops) => pops.filter((item) => item.localId !== localId));
    void queryClient.invalidateQueries({ queryKey: popsQueryKey(channelId) });

    if (pending.alsoPost) void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
  } catch (cause) {
    const unanswered = abort.signal.aborted;
    const unreached = cause instanceof DeadlineError || isNetworkError(cause);

    // База отказала — файлы ничьи. Не дождались ответа или не достучались —
    // файлы остаются для повтора с тем же id, и дублей в Storage нет.
    if (uploaded && !unanswered && !unreached) {
      void removeUploadedMedia(storedPaths(uploaded));
      uploaded = null;
    }

    if (isNetworkError(cause)) reportRequestFailed();

    explain(cause);
    patch(channelId, localId, {
      status: 'failed',
      uploaded,
      uncertain: requested && (unanswered || unreached),
    });
  } finally {
    if (timer) clearTimeout(timer);
    running.delete(localId);
  }
}

/** «Опубликовать» в редакторе: плитка «в пути» сразу, всё остальное — в фоне. */
export function publishNewPop(queryClient: QueryClient, userId: string, input: NewPop) {
  const localId = `local-pop-${randomUuid()}`;

  setChannel(input.channelId, (pops) => [
    {
      ...input,
      localId,
      popId: randomUuid(),
      status: 'publishing',
      uploaded: null,
      uncertain: false,
    },
    ...pops,
  ]);

  void run(queryClient, userId, input.channelId, localId);
}

/** Повтор упавшей публикации — тем же id и, если они уже есть, теми же файлами. */
export function retryPop(
  queryClient: QueryClient,
  userId: string,
  channelId: string,
  localId: string,
) {
  void run(queryClient, userId, channelId, localId);
}

/** Отказ от упавшей публикации: плитка уходит, ничьи файлы — тоже. */
export function discardPop(channelId: string, localId: string) {
  const pending = find(channelId, localId);

  if (!pending || running.has(localId)) return;

  if (pending.uploaded && !pending.uncertain) {
    void removeUploadedMedia(storedPaths(pending.uploaded));
  }

  setChannel(channelId, (pops) => pops.filter((pop) => pop.localId !== localId));
}
