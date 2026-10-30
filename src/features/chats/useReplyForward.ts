import { useRouter } from 'expo-router';
import { useCallback, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import type { ChatRef, IslandOriginal } from '@/api/chats';
import { readChatDraft, startForwardPick } from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import { anchorOf, contentOf, type BubbleRow } from '@/features/chats/islands/rows';
import { quoteOf } from '@/features/chats/messageQuote';
import type { ChatMessage, LiveQuote } from '@/features/chats/messages/types';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { LocalMedia, OutgoingMedia } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { focusWithKeyboard } from '@/lib/windowFocus';
import type { HiddenRange } from '@/features/chats/hiddenText';

type Options = {
  chatId: string;
  /** Этот чат — заголовок островка, если пересылать отсюда. */
  sourceChat: ChatRef;
  draft: ComposerDraft;
  authorName: (authorId: string | null) => string;
  /** Облачко как оригинал для островка: с автором и чатом. Заглушка — `null`. */
  originalOf: (row: BubbleRow) => IslandOriginal | null;
  composerRef: RefObject<TextInput | null>;
  send: (
    text: string,
    media?: OutgoingMedia[],
    replies?: LiveQuote[],
    hidden?: HiddenRange[],
  ) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  /** Пост с попом — только в чате постов канала. */
  sendPop?: (text: string, pop: DraftPop, replies?: LiveQuote[]) => void;
  /** Ключ черновика поля, если он не чат: у шторки треда черновик свой. */
  draftKey?: string;
  /** Поле живёт в своём окне `Modal` (см. `focusWithKeyboard`). */
  ownWindow?: boolean;
};

export type ReplyForward = {
  /** «Ответить»: облачка встают в плашку, фокус — в поле. */
  startReply: (rows: BubbleRow[]) => void;
  /** «Переслать»: дальше — лист «Кому переслать», отправка — оттуда. */
  startForward: (rows: BubbleRow[]) => void;
  /** «О»: текст, альбом или ответ — смотря что в черновике. */
  submit: () => void;
  sendVoice: (voice: LocalMedia) => void;
};

function quoteOfRow(
  row: BubbleRow,
  authorName: (authorId: string | null) => string,
): LiveQuote | null {
  const content: ChatMessage | null = contentOf(row);

  if (!content) return null;

  // Автор облачка островка — не участник этого чата: имя — из оригинала.
  const name =
    row.type === 'island-item'
      ? (row.item.original?.authorName ?? authorName(null))
      : authorName(content.authorId);
  const anchor = anchorOf(row);

  return quoteOf(content, name, anchor ? { forwardId: anchor.id, seq: anchor.seq } : null);
}

/**
 * Ответ поверх черновика поля ввода и начало пересылки. Режим черновика
 * решает, станет ли нажатие «О» ответом с цитатами.
 */
export function useReplyForward({
  chatId,
  sourceChat,
  draft,
  authorName,
  originalOf,
  composerRef,
  send,
  sendVoice: sendVoiceMessage,
  sendPop,
  draftKey = chatId,
  ownWindow = false,
}: Options): ReplyForward {
  const router = useRouter();
  const { mode, setMode } = draft;

  const startReply = useCallback(
    (rows: BubbleRow[]) => {
      // Цитаты — в порядке переписки: так их отдаёт и выбор.
      const quotes = rows.flatMap((row) => quoteOfRow(row, authorName) ?? []);

      if (quotes.length === 0) return;

      setMode({ type: 'reply', quotes });
      claimKeyboardForChat();
      // Меню и выбор закрываются в этом же кадре — поле успевает стать
      // видимым, прежде чем получить фокус.
      focusWithKeyboard(composerRef, undefined, ownWindow);
    },
    [authorName, composerRef, ownWindow, setMode],
  );

  const startForward = useCallback(
    (rows: BubbleRow[]) => {
      // Пересланный комментарий пересылается дальше ссылкой на сам
      // комментарий, а не островком: в островок он не встаёт.
      const comments = rows.flatMap((row) =>
        row.type === 'message' && row.message.commentForward?.comment
          ? [row.message.commentForward.comment]
          : [],
      );

      if (comments.length > 0 && comments.length === rows.length) {
        startForwardPick({ comments });
        router.push({ pathname: '/chats/forward', params: { from: chatId } });
        return;
      }

      if (comments.length > 0) {
        showNotice('Пересланные комментарии пересылаются отдельно от сообщений', 'error');
        return;
      }

      // Порядок — как облачка стоят на экране, и облачко островка
      // пересылается ссылкой на свой оригинал.
      const items = rows.flatMap((row) => {
        const original = originalOf(row);

        return original ? [{ original }] : [];
      });

      if (items.length === 0) return;

      startForwardPick({ sourceChat, items });
      router.push({ pathname: '/chats/forward', params: { from: chatId } });
    },
    [chatId, originalOf, router, sourceChat],
  );

  const submit = useCallback(() => {
    const media = draft.media();
    const { pop } = draft;

    // Пост с попом: поп и фото из галереи в одном посте не встречаются.
    if (pop && sendPop) {
      sendPop(draft.text, pop, mode?.type === 'reply' ? mode.quotes : []);
      draft.setPop(null);
      draft.clear();
      return;
    }

    // Скрытое — из стора, а не из замыкания: «Скрыть найденное» в листе о
    // личных данных дописывает его прямо перед отправкой.
    send(
      draft.text,
      media,
      mode?.type === 'reply' ? mode.quotes : [],
      readChatDraft(draftKey).hidden,
    );
    draft.clear();
  }, [draft, draftKey, mode, send, sendPop]);

  const sendVoice = useCallback(
    (voice: LocalMedia) => {
      if (mode?.type !== 'reply') {
        sendVoiceMessage(voice);
        return;
      }

      // Голосовое тоже может быть ответом; написанный текст остаётся в поле.
      sendVoiceMessage(voice, mode.quotes);
      setMode(null);
    },
    [mode, sendVoiceMessage, setMode],
  );

  return { startReply, startForward, submit, sendVoice };
}
