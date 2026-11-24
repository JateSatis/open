// Сохранение правки своего сообщения: новая версия на экране сразу, загрузка
// новых файлов, вызов `edit_message`, перенос подтверждённого в историю.
// Живёт вне компонентов, как и отправка: ушёл с экрана — правка доедет.

import { requestClient } from '@/api/requestClient';
import { notifyManager, type QueryClient } from '@tanstack/react-query';

import {
  editMessage,
  type EditMediaItem,
  type EditVoiceItem,
  type MessageAttachment,
} from '@/api/chats';
import { editResultKind, isEditUnchanged } from '@/features/chats/editRules';
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
import {
  getConnectionStatus,
  reportRequestFailed,
  subscribeToConnectionStatus,
} from '@/features/connection/connectionStore';
import {
  outgoingLocalMedia,
  removeUploadedMedia,
  storedPaths,
  uploadAllMedia,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';
import { trimWithRanges } from '@/features/chats/hiddenText';

type EditContext = { queryClient: QueryClient; chatId: string; currentUserId: string | null };

/** Новая версия облачка до ответа сервера — с локальными превью новых файлов. */
export function optimisticEdit(original: ChatMessage, result: EditResult): ChatMessage {
  const kind = editResultKind(result);
  const contentChanged = !isEditUnchanged(original, { ...result, hidden: original.hiddenRanges });
  const text = result.text.trim() || null;
  const base = {
    ...original,
    kind,
    text: kind === 'voice' ? null : text,
    hiddenRanges: kind === 'voice' ? [] : trimWithRanges(result.text, result.hidden ?? []).ranges,
    // Скрытое время чата не появляется и у правки: «изменено» — без часов.
    // Сменилось только скрытое — это не правка: ни «изменено», ни нового времени.
    editedAt: !contentChanged
      ? original.editedAt
      : original.createdAt === null
        ? null
        : new Date().toISOString(),
    edited: contentChanged || original.edited,
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

/** Новые файлы правки — в Storage. Ими же пользуется правка комментариев. */
export async function uploadEditFiles(
  result: EditResult,
  userId: string,
  api = requestClient(),
): Promise<UploadedMedia[]> {
  if (result.voice?.type === 'new') return uploadAllMedia([result.voice.voice], userId, api);
  if (result.added.length === 0) return [];

  return uploadAllMedia(await Promise.all(result.added.map(outgoingLocalMedia)), userId, api);
}

/** Итог правки в том виде, в каком его принимает база: оставленное по id, новое — загруженным. */
export function toEditInput(result: EditResult, uploaded: UploadedMedia[]) {
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

  // Без скрытого — без поля: `editMessage` тогда снимает прежнее.
  const hidden = result.voice ? [] : (result.hidden ?? []);

  return {
    text: result.voice ? '' : result.text,
    ...(hidden.length > 0 ? { hidden } : {}),
    media,
    voice,
  };
}

/**
 * Связь пропала надолго — карточка с «Повторить» успеет исчезнуть раньше, чем
 * повтор сможет пройти. Когда связь вернётся, предложение повторяется. Сама
 * правка без спроса не уходит: облачко уже показало прежнюю версию, и тихо
 * поменять его снова было бы неожиданно.
 */
function offerRetryWhenOnline(retry: () => void, api: ReturnType<typeof requestClient>) {
  let offered = false;
  const unsubscribe = subscribeToConnectionStatus(() => {
    if (offered || getConnectionStatus() !== 'online') return;

    offered = true;
    unsubscribe();
    if (api !== requestClient()) return;
    showNotice('Связь вернулась, но изменения не сохранены', 'error', {
      label: 'Повторить',
      run: retry,
    });
  });
}

/** Что сказать человеку, когда правка не прошла. Сырые ошибки базы в интерфейс не попадают. */
function explainFailure(cause: unknown, retry: () => void, api: ReturnType<typeof requestClient>) {
  if (isNetworkError(cause)) {
    reportRequestFailed();
    showNotice('Изменения не сохранены: нет связи', 'error', { label: 'Повторить', run: retry });
    offerRetryWhenOnline(retry, api);
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
  api = requestClient(),
): Promise<void> {
  if (api !== requestClient()) return;
  const { queryClient, chatId, currentUserId } = context;
  const optimistic = optimisticEdit(original, result);
  const retry = () => void saveEdit(context, original, result, api);

  setPendingEdit(chatId, optimistic, api);

  let uploaded: UploadedMedia[] = [];

  try {
    const hasFiles = result.voice?.type === 'new' || result.added.length > 0;

    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadEditFiles(result, currentUserId!, api) : [];

    const saved = await editMessage(original.id, toEditInput(result, uploaded), api);
    if (api.retired) return;

    // Новые файлы продолжают показываться с телефона, пока грузятся
    // удалённые, — как у только что отправленного.
    const previews = optimistic.localPreviews?.some(Boolean)
      ? new Map([[saved.id, optimistic.localPreviews]])
      : undefined;

    updateHistory(queryClient, chatId, (history) => replaceMessages(history, [saved], previews));
    // Наложение снимается в том же проходе, в котором история узнаёт новую
    // версию: облачко не мигает прежней.
    notifyManager.schedule(() => clearPendingEdit(chatId, optimistic, api));

    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    void queryClient.invalidateQueries({ queryKey: pinsQueryKey(chatId) });
  } catch (cause) {
    if (!api.retired) clearPendingEdit(chatId, optimistic, api);

    // Отказ сервера — новые файлы ничьи. При обрыве связи правка могла и
    // дойти, поэтому файлы остаются: удалить их — сломать сохранённое.
    if (uploaded.length > 0 && !isNetworkError(cause)) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item), undefined, api)));
    }

    if (api === requestClient()) explainFailure(cause, retry, api);
  }
}
