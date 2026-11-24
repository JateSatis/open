// Свои заметки в «Сохранённых», которых сервер ещё не подтвердил:
// отправляются или упали. Как исходящие чата (`outbox.ts`) — клиентское
// состояние в Zustand; в кеш страниц заметка попадает только с настоящим id.
// Живёт вне экрана: ушёл из «Сохранённых» посреди отправки — заметка доедет.
//
// Отправка — своя маленькая очередь, а не исходящие чата: у заметки нет
// чата, своя функция базы и свой кеш. Загрузка файлов и превью — общие с
// чатом (`uploadOutgoing`, `toLocalAttachment`, `splitIntoAlbums`): тот же
// путь `uploads` → `sanitize-media`.

import { clientIdentity } from '@/api/perClient';

import { requestClient } from '@/api/requestClient';
import { notifyManager, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { PENDING_SEQ } from '@/api/pendingSeq';
import {
  deleteSavedMessages,
  deleteSavedNoteByClient,
  getSavedMessage,
  sendSavedNote,
  type SavedFilterInput,
  type SavedNoteFile,
  type SavedPage,
} from '@/api/saved';
import {
  errorCode,
  nextLocalId,
  splitIntoAlbums,
  toLocalAttachment,
  toLocalVoiceAttachment,
  uploadOutgoing,
} from '@/features/chats/messages/delivery';
import type { LiveQuote, Outgoing } from '@/features/chats/messages/types';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  mediaRejectionText,
  removeUploadedMedia,
  storedPaths,
  type LocalMedia,
  type OutgoingMedia,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { savedMessagesKey, savedMessagesQueryKey } from '@/features/saved/keys';
import { filterKey, toFilterInput } from '@/features/saved/savedFilters';
import { getSavedFilters } from '@/features/saved/savedFiltersStore';
import {
  findPending,
  removePending,
  setItems,
  setStatus,
  type NoteAuthor,
  type NotePayload,
  type PendingNote,
} from '@/features/saved/notesStore';
import type { SavedItem } from '@/features/saved/savedCopy';
import { isNetworkError } from '@/lib/network';
import { randomUuid } from '@/lib/uuid';

// Связь мигает чаще, чем доезжает заметка с файлами: повтор поверх ещё не
// законченной попытки отправил бы её дважды (база это поймала бы по ключу,
// но файлы залились бы снова). Ключ отправки — localId.
const delivering = new Set<string>();
// Человек удалил свою неотправленную заметку, пока она ещё ехала.
const discarded = new Set<string>();
// Файлы, уже залитые для заметки, по localId: повтор их не грузит заново.
const uploadedFor = new Map<string, UploadedMedia[]>();
// Заметки, чья последняя попытка осталась без ответа, — могли создаться.
const unanswered = new Set<string>();

let pendingSeqCounter = 0;

function toNoteFile(item: UploadedMedia): SavedNoteFile {
  return {
    url: item.url,
    posterUrl: item.posterUrl,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    waveform: item.waveform,
  };
}

function toOutgoing(payload: NotePayload): Outgoing {
  return payload.type === 'voice'
    ? { type: 'voice', voice: payload.voice, replyTo: [] }
    : { type: 'post', text: payload.text, media: payload.media, replyTo: [] };
}

/**
 * Заметка — в первую страницу списка с самыми новыми записями.
 */
function putNewest(queryClient: QueryClient, key: string | null, saved: SavedItem) {
  queryClient.setQueryData<InfiniteData<SavedPage, unknown>>(savedMessagesKey(key), (data) => {
    if (!data || data.pages.length === 0) return data;

    const [first, ...rest] = data.pages;

    if (data.pages.some((page) => page.items.some((item) => item.id === saved.id))) {
      return data;
    }

    return { ...data, pages: [{ ...first, items: [saved, ...first.items] }, ...rest] };
  });
}

/**
 * На «Все» стоят фильтры: подходит ли под них новая заметка, решает база.
 * Подходит — встаёт внизу отфильтрованного списка, нет — человеку говорят,
 * куда она делась.
 */
async function placeFiltered(queryClient: QueryClient, saved: SavedItem, filter: SavedFilterInput, api = requestClient()) {
  const shown = await getSavedMessage(saved.id, filter, api).catch(() => null);

  if (shown) {
    putNewest(queryClient, filterKey(filter), saved);
    return;
  }

  if (api === requestClient()) showNotice('Заметка сохранена, но скрыта фильтрами', 'info');
}

/** Подтверждённая заметка — в «Все» без фильтра и в текущий отфильтрованный список. */
function settle(queryClient: QueryClient, localId: string, saved: SavedItem, api = requestClient()) {
  const pending = findPending(localId);
  const confirmed: SavedItem = { ...saved, localPreviews: pending?.localPreviews };
  const filter = toFilterInput(getSavedFilters());

  putNewest(queryClient, null, confirmed);
  if (filter) void placeFiltered(queryClient, confirmed, filter, api);

  // Как у сообщений чата: пока страница не перерисовалась, в исходящих лежит
  // уже подтверждённая копия под настоящим id — экран склеивает их по id.
  setItems((items) =>
    items.map((item) => (item.localId === localId ? { ...item, ...confirmed, localId } : item)),
  );
  notifyManager.schedule(() => removePending(localId));
}

/** Отказ, который повтор не исправит, — объяснить человеку. */
function explainRejection(cause: unknown) {
  if (errorCode(cause) === 'P0002') {
    showNotice('Не отправлено: запись, на которую вы отвечаете, удалена', 'error');
    return;
  }

  const media = mediaRejectionText(cause);

  if (media) showNotice(media, 'error');
}

/** Заметка записана, а её строку прочитать не вышло — перечитать страницы. */
function settleUnread(queryClient: QueryClient, localId: string) {
  void queryClient
    .invalidateQueries({ queryKey: savedMessagesQueryKey })
    .then(() => removePending(localId));
}

async function deliver(queryClient: QueryClient, userId: string, localId: string, api = requestClient()) {
  const note = findPending(localId);

  if (!note || (note.deliveryOwner && note.deliveryOwner !== clientIdentity(api)) || delivering.has(localId)) return;

  delivering.add(localId);
  setStatus(localId, 'sending');

  const { payload } = note;
  let uploaded: UploadedMedia[] = [];
  let id: string | null = null;

  try {
    const hasFiles = payload.type === 'voice' || payload.media.length > 0;

    // Повтор — теми же файлами: они уже очищены, а заметка с этим ключом
    // могла создаться и ссылаться именно на них.
    uploaded =
      uploadedFor.get(localId) ??
      (hasFiles ? await uploadOutgoing(toOutgoing(payload), userId, api) : []);
    uploadedFor.set(localId, uploaded);

    if (discarded.has(localId)) throw new Error('Отправка отменена');

    id = await sendSavedNote({
      clientId: note.clientId,
      text: payload.type === 'post' ? payload.text || null : null,
      files: uploaded.map(toNoteFile),
      replyTo: payload.replyTo,
      kind: payload.type,
    }, api);
    uploadedFor.delete(localId);
    unanswered.delete(localId);

    // Уже в базе, но человек её удалил — удаляем и там.
    if (discarded.has(localId)) {
      void deleteSavedMessages([id], api).catch(() => undefined);
      return;
    }

    const saved = await getSavedMessage(id, undefined, api).catch(() => null);

    if (api !== requestClient()) return;
    if (saved) settle(queryClient, localId, saved, api);
    else settleUnread(queryClient, localId);
  } catch (cause) {
    const lost = isNetworkError(cause);

    // Сервер ответил отказом — загруженные файлы ничьи. Не ответил вовсе —
    // заметка могла создаться: её файлы не трогаем, повтор найдёт её по ключу.
    if (!id && uploaded.length > 0 && !lost) {
      uploadedFor.delete(localId);
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item), undefined, api)));
    }

    if (!id && lost) unanswered.add(localId);

    if (discarded.has(localId)) {
      forget(localId, note.clientId, api);
      return;
    }

    if (api !== requestClient()) return;
    if (lost) reportRequestFailed();
    else explainRejection(cause);

    setStatus(localId, 'failed');
  } finally {
    delivering.delete(localId);
    discarded.delete(localId);
  }
}

/**
 * Неотправленную заметку убрали насовсем. Последняя попытка осталась без
 * ответа — заметка могла создаться: удалить её и на сервере, по ключу.
 */
function forget(localId: string, clientId: string, api = requestClient()) {
  uploadedFor.delete(localId);

  if (unanswered.delete(localId)) {
    void deleteSavedNoteByClient(clientId, api).catch(() => undefined);
  }
}

function draftOf(
  author: NoteAuthor,
  payload: NotePayload,
  at: number,
  quotes: LiveQuote[],
  deliveryClient: ReturnType<typeof requestClient>,
): PendingNote {
  const localId = nextLocalId();
  const voice = payload.type === 'voice' ? payload.voice : null;
  const attachments = voice
    ? [toLocalVoiceAttachment(localId, voice)]
    : payload.type === 'post'
      ? payload.media.map(toLocalAttachment)
      : [];

  pendingSeqCounter += 1;

  return {
    id: localId,
    deliveryOwner: clientIdentity(deliveryClient),
    localId,
    clientId: randomUuid(),
    payload,
    status: 'sending',
    seq: PENDING_SEQ + pendingSeqCounter,
    savedAt: new Date(at).toISOString(),
    sourceType: 'note',
    category: 'note',
    sourceChatId: null,
    sourceMessageId: null,
    sourceCommentId: null,
    kind: voice ? 'voice' : attachments.length > 0 ? 'media' : 'text',
    text: payload.type === 'post' ? payload.text || null : null,
    authorId: author.id,
    authorName: author.name,
    authorAvatarUrl: author.avatarUrl,
    authorOpaque: false,
    originalAt: new Date(at).toISOString(),
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments,
    tagIds: [],
    edited: false,
    replies: [],
    pendingQuotes: quotes,
    localPreviews: voice ? [voice.uri] : attachments.map((attachment) => attachment.url),
  };
}

/**
 * Заметка с текстом и файлами. Больше `MAX_ALBUM_SIZE` файлов — несколько
 * заметок по порядку, подпись и цитаты — у первой. Появляются сразу, уходят
 * по очереди.
 */
export function sendNotePost(
  queryClient: QueryClient,
  author: NoteAuthor,
  text: string,
  media: OutgoingMedia[],
  quotes: LiveQuote[],
  api = requestClient(),
) {
  const trimmed = text.trim();

  if (!trimmed && media.length === 0) return;

  const now = Date.now();
  const drafts = splitIntoAlbums(trimmed, media).map((part, index) =>
    draftOf(
      author,
      {
        type: 'post',
        text: part.text,
        media: part.media,
        replyTo: index === 0 ? quotes.map((quote) => quote.messageId) : [],
      },
      now + index,
      index === 0 ? quotes : [],
      api,
    ),
  );

  setItems((items) => [...[...drafts].reverse(), ...items]);

  void (async () => {
    for (const draft of drafts) await deliver(queryClient, author.id, draft.localId, api);
  })();
}

export function sendNoteVoice(
  queryClient: QueryClient,
  author: NoteAuthor,
  voice: LocalMedia,
  quotes: LiveQuote[],
  api = requestClient(),
) {
  const draft = draftOf(
    author,
    { type: 'voice', voice, replyTo: quotes.map((quote) => quote.messageId) },
    Date.now(),
    quotes,
    api,
  );

  setItems((items) => [draft, ...items]);
  void deliver(queryClient, author.id, draft.localId, api);
}

/** «Повторить» у упавшей заметки — с тем же ключом: дубля не будет. */
export function retryNote(queryClient: QueryClient, userId: string, localId: string, api = requestClient()) {
  void deliver(queryClient, userId, localId, api);
}

/**
 * Своя неотправленная заметка — убрать. Если она как раз едет на сервер, её
 * удалят сразу по прибытии.
 */
export function discardNote(localId: string, api = requestClient()) {
  const note = findPending(localId);

  if (delivering.has(localId)) discarded.add(localId);
  else if (note) forget(localId, note.clientId, api);

  removePending(localId);
}
