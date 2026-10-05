import { useRouter } from 'expo-router';
import { useCallback, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import type { ChatRef, ForwardedComment, IslandOriginal } from '@/api/chats';
import { startForwardPick } from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import { anchorOf, contentOf, type BubbleRow } from '@/features/chats/islands/rows';
import { quoteOf } from '@/features/chats/messageQuote';
import type { ChatMessage, ForwardItem, LiveQuote } from '@/features/chats/messages/types';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { focusWithKeyboard } from '@/lib/windowFocus';

type Options = {
  chatId: string;
  /** Этот чат — заголовок островка, если пересылать отсюда. */
  sourceChat: ChatRef;
  draft: ComposerDraft;
  authorName: (authorId: string | null) => string;
  /** Облачко как оригинал для островка: с автором и чатом. Заглушка — `null`. */
  originalOf: (row: BubbleRow) => IslandOriginal | null;
  composerRef: RefObject<TextInput | null>;
  send: (text: string, media?: MediaLibraryItem[], replies?: LiveQuote[]) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  forward: (text: string, sourceChat: ChatRef, items: ForwardItem[]) => void;
  forwardComments: (text: string, comments: ForwardedComment[]) => void;
};

export type ReplyForward = {
  /** «Ответить»: облачка встают в плашку, фокус — в поле. */
  startReply: (rows: BubbleRow[]) => void;
  /** «Переслать»: дальше — экран выбора чата. */
  startForward: (rows: BubbleRow[]) => void;
  /** «О»: текст, альбом, ответ или пересылка — смотря что в черновике. */
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

  return quoteOf(
    content,
    name,
    anchor ? { forwardId: anchor.id, createdAt: anchor.createdAt } : null,
  );
}

/**
 * Ответ и пересылка поверх черновика поля ввода. Режим черновика решает,
 * чем станет нажатие «О»: ответом с цитатами или пересылкой.
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
  forward,
  forwardComments,
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
      focusWithKeyboard(composerRef);
    },
    [authorName, composerRef, setMode],
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

    // Пересылка с подписью. Альбом из шита медиа при этом уходит обычным
    // сообщением, а пересылка ждёт своей очереди в плашке.
    if (mode?.type === 'forward' && media.length === 0) {
      forward(draft.text, mode.sourceChat, mode.items);
      draft.clear();
      return;
    }

    if (mode?.type === 'forward_comments' && media.length === 0) {
      forwardComments(draft.text, mode.comments);
      draft.clear();
      return;
    }

    send(draft.text, media, mode?.type === 'reply' ? mode.quotes : []);

    if (mode?.type === 'forward' || mode?.type === 'forward_comments') {
      draft.setText('');
      draft.clearMedia();
      return;
    }

    draft.clear();
  }, [draft, forward, forwardComments, mode, send]);

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
