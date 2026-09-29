// Сохранение правки своего сообщения: новая версия на экране сразу, загрузка
// новых файлов, вызов `edit_message`, перенос подтверждённого в историю.
// Живёт вне компонентов, как и отправка: ушёл с экрана — правка доедет.

import { notifyManager, type QueryClient } from '@tanstack/react-query';

import {
  editMessage,
  type EditMediaItem,
  type EditVoiceItem,
  type MessageAttachment,
} from '@/api/chats';
import { editResultKind } from '@/features/chats/editRules';
import {
  errorCode,
  toLocalAttachment,
  toLocalVoiceAttachment,
  toSendMedia,
} from '@/features/chats/messages/delivery';
import { replaceMessages, updateHistory } from '@/features/chats/messages/historyCache';
import { clearPendingEdit, setPendingEdit } from '@/features/chats/messages/pendingEdits';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import { chatsQueryKey } from '@/features/chats/useChats';
import { pinsQueryKey } from '@/features/chats/usePinnedMessages';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  libraryAssetToLocalMedia,
  removeUploadedMedia,
  resolveLibraryAsset,
  storedPaths,
  uploadAllMedia,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

type EditContext = { queryClient: QueryClient; chatId: string; currentUserId: string | null };

/** Новая версия облачка до ответа сервера — с локальными превью новых файлов. */
export function optimisticEdit(original: ChatMessage, result: EditResult): ChatMessage {
  const kind = editResultKind(result);
  const text = result.text.trim() || null;
  const base = {
    ...original,
    kind,
    text: kind === 'voice' ? null : text,
    editedAt: new Date().toISOString(),
    editStatus: 'saving' as const,
  };

  if (result.voice?.type === 'kept') {
    return {
      ...base,
      attachments: [result.voice.attachment],
      localPreviews: result.voice.localUri ? [result.voice.localUri] : undefined,
    };
  }

  if (result.voice?.type === 'new') {
    return {
      ...base,
      attachments: [toLocalVoiceAttachment(original.id, result.voice.voice)],
      localPreviews: [result.voice.voice.uri],
    };
  }

  const added = result.added.map(toLocalAttachment);

  return {
    ...base,
    attachments: [...result.kept, ...added],
    // Превью по позициям: у оставленных своего нет, у новых — файл на телефоне.
    localPreviews: [...result.kept.map(() => ''), ...added.map((attachment) => attachment.url)],
  };
}

async function uploadNew(result: EditResult, userId: string): Promise<UploadedMedia[]> {
  if (result.voice?.type === 'new') return uploadAllMedia([result.voice.voice], userId);
  if (result.added.length === 0) return [];

  const resolved = await Promise.all(result.added.map(resolveLibraryAsset));

  return uploadAllMedia(resolved.map(libraryAssetToLocalMedia), userId);
}

function toInput(result: EditResult, uploaded: UploadedMedia[]) {
  let voice: EditVoiceItem | null = null;

  if (result.voice?.type === 'kept') voice = { attachmentId: result.voice.attachment.id };

  if (result.voice?.type === 'new') {
    const [file] = uploaded;

    voice = {
      url: file.url,
      mimeType: file.mimeType,
      durationMs: file.durationMs ?? 0,
      sizeBytes: file.sizeBytes,
      waveform: file.waveform,
    };
  }

  const media: EditMediaItem[] = result.voice
    ? []
    : [
        ...result.kept.map((attachment: MessageAttachment) => ({ attachmentId: attachment.id })),
        ...uploaded.map(toSendMedia),
      ];

  return { text: result.voice ? '' : result.text, media, voice };
}

/** Что сказать человеку, когда правка не прошла. Сырые ошибки базы в интерфейс не попадают. */
function explainFailure(cause: unknown, retry: () => void) {
  if (isNetworkError(cause)) {
    reportRequestFailed();
    showNotice('Изменения не сохранены: нет связи', 'error', { label: 'Повторить', run: retry });
    return;
  }

  const code = errorCode(cause);

  if (code === 'P0002') {
    showNotice('Не удалось изменить: сообщение удалено', 'error');
    return;
  }

  if (code === '42501') {
    showNotice('Это сообщение изменить нельзя', 'error');
    return;
  }

  showNotice('Изменения не сохранены', 'error', { label: 'Повторить', run: retry });
}

/**
 * Сохраняет правку. Облачко сразу показывает новую версию с «изменено»; если
 * сервер отказал или загрузка упала, оно возвращается к прежней, а человек
 * видит ошибку с «Повторить».
 */
export async function saveEdit(
  context: EditContext,
  original: ChatMessage,
  result: EditResult,
): Promise<void> {
  const { queryClient, chatId, currentUserId } = context;
  const optimistic = optimisticEdit(original, result);
  const retry = () => void saveEdit(context, original, result);

  setPendingEdit(chatId, optimistic);

  let uploaded: UploadedMedia[] = [];

  try {
    const hasFiles = result.voice?.type === 'new' || result.added.length > 0;

    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadNew(result, currentUserId!) : [];

    const saved = await editMessage(original.id, toInput(result, uploaded));

    // Новые файлы продолжают показываться с телефона, пока грузятся
    // удалённые, — как у только что отправленного.
    const previews = optimistic.localPreviews?.some(Boolean)
      ? new Map([[saved.id, optimistic.localPreviews]])
      : undefined;

    updateHistory(queryClient, chatId, (history) => replaceMessages(history, [saved], previews));
    // Наложение снимается в том же проходе, в котором история узнаёт новую
    // версию: облачко не мигает прежней.
    notifyManager.schedule(() => clearPendingEdit(chatId, optimistic));

    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
  } catch (cause) {
    clearPendingEdit(chatId, optimistic);

    // Отказ сервера — новые файлы ничьи. При обрыве связи правка могла и
    // дойти, поэтому файлы остаются: удалить их — сломать сохранённое.
    if (uploaded.length > 0 && !isNetworkError(cause)) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item))));
    }

    explainFailure(cause, retry);
  }
}
