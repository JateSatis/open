// Правки сохранённого из меню, выбора и вкладки «Посмотреть позже». Сразу —
// в кеше всех вкладок, потом — запрос; не вышло — откат и уведомление.
// Простые функции, а не `useMutation`: без сети запрос не встаёт на паузу,
// срок ответа держит `withDeadline` (как `saveToSaved`).

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  createSavedTag,
  deleteSavedMessages,
  editSavedNote,
  restoreSavedWatchLater,
  setSavedPinned,
  setSavedTag,
  setSavedWatchLater,
  type SavedMessage,
  type SavedTag,
  type WatchLaterState,
} from '@/api/saved';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import { showNotice } from '@/features/notifications/alertsStore';
import { savedQueryKey, savedTagsQueryKey, savedWatchLaterQueryKey } from '@/features/saved/keys';
import {
  bumpPending,
  findSaved,
  patchQuotes,
  patchSaved,
  putInWatchLater,
  refreshFiltered,
  rollbackSaved,
  type SavedPatch,
} from '@/features/saved/savedCache';
import type { SavedItem } from '@/features/saved/savedCopy';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

const SAVED_DEADLINE_MS = 15_000;

function failed(cause: unknown, text: string) {
  if (isNetworkError(cause)) reportRequestFailed();

  showNotice(text, 'error');
}

/**
 * Правка в кеше и запрос. Удача — `onDone`; неудача — прежние версии
 * обратно. Ответ после срока — правка всё же прошла: кеш перечитывается.
 */
async function optimistic(
  queryClient: QueryClient,
  ids: readonly string[],
  patch: SavedPatch,
  request: () => Promise<void>,
  failText: string,
): Promise<boolean> {
  const before = patchSaved(queryClient, ids, patch);

  try {
    await withDeadline(request(), SAVED_DEADLINE_MS, () => {
      void queryClient.invalidateQueries({ queryKey: savedQueryKey });
    });
    return true;
  } catch (cause) {
    rollbackSaved(queryClient, before);
    // Запись, которой не было среди загруженного «Все», откатом не вернуть.
    void queryClient.invalidateQueries({ queryKey: savedWatchLaterQueryKey });
    failed(cause, failText);
    return false;
  } finally {
    refreshFiltered(queryClient);
  }
}

function withTag(saved: SavedMessage, tagId: string, on: boolean): SavedMessage {
  const has = saved.tagIds.includes(tagId);

  if (has === on) return saved;

  return {
    ...saved,
    tagIds: on ? [...saved.tagIds, tagId] : saved.tagIds.filter((id) => id !== tagId),
  };
}

function withWatch(saved: SavedMessage, state: WatchLaterState, now: string): SavedMessage {
  switch (state) {
    case 'later':
      return saved.watchLaterAt ? saved : { ...saved, watchLaterAt: now, watchDoneAt: null };
    case 'done':
      return saved.watchLaterAt && !saved.watchDoneAt ? { ...saved, watchDoneAt: now } : saved;
    case 'undone':
      return { ...saved, watchDoneAt: null };
    case 'off':
      return { ...saved, watchLaterAt: null, watchDoneAt: null };
  }
}

function bumpTagUses(queryClient: QueryClient, tagId: string, delta: number) {
  queryClient.setQueryData<SavedTag[]>(savedTagsQueryKey, (tags) =>
    tags?.map((tag) =>
      tag.id === tagId ? { ...tag, usesCount: Math.max(0, tag.usesCount + delta) } : tag,
    ),
  );
}

export type SavedActions = {
  /** Поставить или снять тег — сразу, меню не закрывается. */
  toggleTag: (saved: SavedMessage, tagId: string) => void;
  /** Новый тег (или уже существующий с тем же именем) — и сразу записи. */
  createTag: (saved: SavedMessage, name: string) => Promise<void>;
  setWatchLater: (ids: readonly string[], state: WatchLaterState) => void;
  /** «Вернуть» после свайпа: прежние время добавления и отметка. */
  restoreWatchLater: (saved: SavedMessage) => void;
  setPinned: (ids: readonly string[], pinned: boolean) => void;
  /** Без подтверждения: диалог спрашивает тот, кто зовёт. */
  remove: (ids: readonly string[]) => void;
  /**
   * Правка своей заметки: новый текст и какие вложения оставить, по порядку.
   * Облачко сразу показывает новую версию с часиками; отказ — прежняя.
   */
  editNote: (saved: SavedMessage, text: string, keep: readonly string[]) => void;
};

export function useSavedActions(): SavedActions {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const toggleTag = (saved: SavedMessage, tagId: string) => {
      const on = !saved.tagIds.includes(tagId);

      bumpTagUses(queryClient, tagId, on ? 1 : -1);
      void optimistic(
        queryClient,
        [saved.id],
        (item) => withTag(item, tagId, on),
        () => setSavedTag(saved.id, tagId, on),
        'Не удалось изменить теги',
      ).then((ok) => {
        if (!ok) bumpTagUses(queryClient, tagId, on ? -1 : 1);
      });
    };

    return {
      toggleTag,
      createTag: async (saved, name) => {
        try {
          const tag = await withDeadline(createSavedTag(name), SAVED_DEADLINE_MS);

          queryClient.setQueryData<SavedTag[]>(savedTagsQueryKey, (tags) =>
            tags && !tags.some((item) => item.id === tag.id) ? [...tags, tag] : tags,
          );

          if (!saved.tagIds.includes(tag.id)) toggleTag(saved, tag.id);
        } catch (cause) {
          failed(cause, 'Не удалось создать тег');
        }
      },
      setWatchLater: (ids, state) => {
        const now = new Date().toISOString();

        void optimistic(
          queryClient,
          ids,
          (item) => withWatch(item, state, now),
          () => setSavedWatchLater([...ids], state),
          'Не удалось изменить «Посмотреть позже»',
        );
      },
      restoreWatchLater: (saved) => {
        const { watchLaterAt, watchDoneAt } = saved;

        if (!watchLaterAt) return;

        // Нет ни в одном списке (а «Все» до неё не догружены) — вставить
        // самому и вернуть её в счётчик: правка такую запись не найдёт.
        if (!findSaved(queryClient, saved.id)) {
          putInWatchLater(queryClient, saved);
          if (!watchDoneAt) bumpPending(queryClient, 1);
        }

        void optimistic(
          queryClient,
          [saved.id],
          (item) => ({ ...item, watchLaterAt, watchDoneAt }),
          () => restoreSavedWatchLater(saved.id, watchLaterAt, watchDoneAt),
          'Не удалось вернуть',
        );
      },
      setPinned: (ids, pinned) => {
        const now = new Date().toISOString();

        void optimistic(
          queryClient,
          ids,
          (item) =>
            pinned ? { ...item, pinnedAt: item.pinnedAt ?? now } : { ...item, pinnedAt: null },
          () => setSavedPinned([...ids], pinned),
          pinned ? 'Не удалось закрепить' : 'Не удалось открепить',
        );
      },
      editNote: (saved, text, keep) => {
        const trimmed = text.trim();
        const attachments = keep.flatMap(
          (id) => saved.attachments.find((attachment) => attachment.id === id) ?? [],
        );

        void optimistic(
          queryClient,
          [saved.id],
          (item): SavedItem => ({
            ...item,
            text: trimmed || null,
            attachments,
            kind: item.kind === 'media' && attachments.length === 0 ? 'text' : item.kind,
            edited: true,
            editStatus: 'saving',
          }),
          () => editSavedNote(saved.id, trimmed, [...keep]),
          'Изменения не сохранены',
        ).then((ok) => {
          if (!ok) return;

          patchSaved(queryClient, [saved.id], ({ editStatus: _done, ...item }: SavedItem) => item);
          // Ответы на неё показывают её новую версию.
          patchQuotes(queryClient, (quote) =>
            quote.savedId === saved.id
              ? {
                  ...quote,
                  text: trimmed || null,
                  kind: quote.kind === 'media' && attachments.length === 0 ? 'text' : quote.kind,
                  attachments: attachments.map((attachment, position) => ({
                    url: attachment.url,
                    poster_url: attachment.posterUrl,
                    mime_type: attachment.mimeType,
                    duration_ms: attachment.durationMs,
                    position,
                    pop_id: attachment.popId ?? null,
                  })),
                }
              : quote,
          );
        });
      },
      remove: (ids) => {
        const gone = new Set(ids);

        patchSaved(queryClient, ids, () => null);
        // Ответы на удалённое — с заглушкой «Запись удалена», как их отдаст база.
        patchQuotes(queryClient, (quote) => (gone.has(quote.savedId) ? { savedId: null } : quote));

        void withDeadline(deleteSavedMessages([...ids]), SAVED_DEADLINE_MS)
          .then(() => {
            // Счётчики тегов уменьшила база.
            void queryClient.invalidateQueries({ queryKey: savedTagsQueryKey });
          })
          .catch((cause: unknown) => {
            // Удалённое из списков откатом не вставить на место — перечитать.
            void queryClient.invalidateQueries({ queryKey: savedQueryKey });
            failed(cause, 'Не удалось удалить');
          });
      },
    };
  }, [queryClient]);
}
