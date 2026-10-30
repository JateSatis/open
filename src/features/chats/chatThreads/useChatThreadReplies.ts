import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { MessageKind } from '@/api/chats';
import type { MessagePreview } from '@/api/messagePreview';
import { openChatThread } from '@/features/chats/chatThreads/chatThreadPanelStore';
import { bumpChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import { readAllHistories } from '@/features/chats/messages/historyCache';
import type { LiveQuote } from '@/features/chats/messages/types';
import type { OutgoingMedia } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';

/** Что ушло — для превью на плашке до ответа сервера. */
export type SentContent = {
  kind: Extract<MessageKind, 'text' | 'media' | 'voice'>;
  text: string;
  media?: OutgoingMedia[];
  durationMs?: number | null;
};

type Options = {
  chatId: string;
  /** Открыт вид «Треды»: только там ответ уходит из ленты. */
  active: boolean;
  me: { userId: string; name: string | null; avatarUrl: string | null } | undefined;
};

/**
 * Корни тредов, куда войдёт ответ с этими цитатами: у цитаты на ответ — его
 * корни, иначе само цитируемое. Цитата оригинала из островка треда не
 * создаёт. Так же считает база (`link_chat_thread_reply`).
 */
export function chatThreadRootsOf(queryClient: QueryClient, quotes: LiveQuote[]): string[] {
  const loaded = new Map(
    readAllHistories(queryClient)
      .flatMap((history) => history.items)
      .map((message) => [message.id, message]),
  );

  return [
    ...new Set(
      quotes
        .filter((quote) => !quote.via)
        .flatMap((quote) => {
          const roots = loaded.get(quote.messageId)?.chatThreadRootIds;

          return roots?.length ? roots : [quote.messageId];
        }),
    ),
  ];
}

export function sentPreview({ kind, text, media = [], durationMs = null }: SentContent): MessagePreview {
  return {
    kind,
    text: text.trim() || null,
    thumbnailUrl: null,
    mediaCount: media.length,
    firstMediaIsVideo: media[0]?.kind === 'video',
    durationMs: kind === 'voice' ? durationMs : null,
    isPop: false,
  };
}

/**
 * Свой ответ из основного поля, пока чат в «Тредах»: в ленте он не встаёт —
 * плашка его корня меняется сразу (+1, я, мой текст), а всплывашка «Ответ
 * ушёл в тред» открывает шторку этого треда.
 */
export function useChatThreadReplies({ chatId, active, me }: Options) {
  const queryClient = useQueryClient();

  const announce = useCallback(
    (quotes: LiveQuote[], content: SentContent) => {
      if (!active || !me) return;

      const roots = chatThreadRootsOf(queryClient, quotes);

      if (roots.length === 0) return;

      bumpChatThreadSummaries(
        queryClient,
        chatId,
        roots,
        { id: me.userId, name: me.name ?? 'Я', avatarUrl: me.avatarUrl },
        sentPreview(content),
      );
      showNotice('Ответ ушёл в тред', 'info', {
        label: 'Открыть',
        run: () => openChatThread({ chatId, rootId: roots[0], focusMessageId: 'end' }),
      });
    },
    [active, chatId, me, queryClient],
  );

  return { announce };
}
