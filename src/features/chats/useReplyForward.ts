import { useRouter } from 'expo-router';
import { useCallback, type RefObject } from 'react';
import type { TextInput } from 'react-native';

import { startForwardPick } from '@/features/chats/composerDraftStore';
import { claimKeyboardForChat } from '@/features/chats/composerKeyboard';
import { byOldest, originOf, quoteOf } from '@/features/chats/messageQuote';
import type { ChatMessage, ForwardItem, LiveQuote } from '@/features/chats/messages/types';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';

type Options = {
  chatId: string;
  draft: ComposerDraft;
  authorName: (authorId: string | null) => string;
  composerRef: RefObject<TextInput | null>;
  send: (text: string, media?: MediaLibraryItem[], replies?: LiveQuote[]) => void;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => void;
  forward: (text: string, items: ForwardItem[]) => void;
};

export type ReplyForward = {
  /** «Ответить»: сообщения встают в плашку, фокус — в поле. */
  startReply: (messages: ChatMessage[]) => void;
  /** «Переслать»: дальше — экран выбора чата. */
  startForward: (messages: ChatMessage[]) => void;
  /** «О»: текст, альбом, ответ или пересылка — смотря что в черновике. */
  submit: () => void;
  sendVoice: (voice: LocalMedia) => void;
};

/**
 * Ответ и пересылка поверх черновика поля ввода. Режим черновика решает,
 * чем станет нажатие «О»: ответом с цитатами или пересылкой.
 */
export function useReplyForward({
  chatId,
  draft,
  authorName,
  composerRef,
  send,
  sendVoice: sendVoiceMessage,
  forward,
}: Options): ReplyForward {
  const router = useRouter();
  const { mode, setMode } = draft;

  const startReply = useCallback(
    (messages: ChatMessage[]) => {
      if (messages.length === 0) return;

      // Цитаты — в порядке переписки, как бы их ни отмечали.
      const quotes = [...messages]
        .sort(byOldest)
        .map((message) => quoteOf(message, authorName(message.authorId)));

      setMode({ type: 'reply', quotes });
      claimKeyboardForChat();
      // Меню и выбор закрываются в этом же кадре — поле успевает стать
      // видимым, прежде чем получить фокус.
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [authorName, composerRef, setMode],
  );

  const startForward = useCallback(
    (messages: ChatMessage[]) => {
      if (messages.length === 0) return;

      startForwardPick(
        [...messages].sort(byOldest).map((message) => ({
          message,
          origin: originOf(message, authorName(message.authorId)),
        })),
      );
      router.push({ pathname: '/chats/forward', params: { from: chatId } });
    },
    [authorName, chatId, router],
  );

  const submit = useCallback(() => {
    const media = draft.media();

    // Пересылка с подписью. Альбом из шита медиа при этом уходит обычным
    // сообщением, а пересылка ждёт своей очереди в плашке.
    if (mode?.type === 'forward' && media.length === 0) {
      forward(draft.text, mode.items);
      draft.clear();
      return;
    }

    send(draft.text, media, mode?.type === 'reply' ? mode.quotes : []);

    if (mode?.type === 'forward') {
      draft.setText('');
      draft.clearMedia();
      return;
    }

    draft.clear();
  }, [draft, forward, mode, send]);

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
