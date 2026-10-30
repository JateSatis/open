import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import type { TextInput } from 'react-native';

import type { ChatThreadPanelKit } from './kit';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { bumpChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import {
  chatThreadRootsOf,
  sentPreview,
  type SentContent,
} from '@/features/chats/chatThreads/useChatThreadReplies';
import { readChatDraft } from '@/features/chats/composerDraftStore';
import type { HiddenRange } from '@/features/chats/hiddenText';
import { contentOf, type BubbleRow, type ChatListRow } from '@/features/chats/islands/rows';
import {
  canReactTo,
  visibleMessageActions,
  type MessageActionId,
} from '@/features/chats/messageActions';
import { quoteOf } from '@/features/chats/messageQuote';
import type { ChatMessage, LiveQuote } from '@/features/chats/messages/types';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useMessageActionHandlers } from '@/features/chats/useMessageActionHandlers';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { isSelectableRow, useMessageSelection } from '@/features/chats/useMessageSelection';
import { useReplyForward } from '@/features/chats/useReplyForward';
import { openComments } from '@/features/interactions/CommentsPanel';
import { menuReactionSet } from '@/features/interactions/reactionState';
import type { LocalMedia, OutgoingMedia } from '@/features/media';

type Options = {
  kit: ChatThreadPanelKit;
  rootId: string;
  root: ChatMessage | null;
  /** Самый новый ответ — адресат по умолчанию, если корень удалён. */
  newestReply: ChatMessage | null;
  /** Облачка шторки новыми вперёд — для выбора. */
  bubbleRows: ChatListRow[];
  measureList: () => Promise<AnchorRect | null>;
  /** Закрыть шторку — перед уходом в пересылку и в «Показать в чате». */
  close: () => void;
};

export function chatThreadDraftKey(chatId: string, rootId: string): string {
  return `chat-thread:${chatId}:${rootId}`;
}

/**
 * Действия шторки треда — те же, что в переписке: меню, выбор, ответ,
 * правка, пересылка, удаление, закреп, комментарии и «Показать в чате».
 * Поле ввода — своё: по умолчанию это ответ на исходное сообщение, после
 * «Ответить» — на выбранное.
 */
export function useChatThreadActions({
  kit,
  rootId,
  root,
  newestReply,
  bubbleRows,
  measureList,
  close,
}: Options) {
  const queryClient = useQueryClient();
  const { chatId, currentUserId, isMember, authorName, me } = kit;
  const draftKey = chatThreadDraftKey(chatId, rootId);
  const draft = useComposerDraft(draftKey);
  const composerRef = useRef<TextInput>(null);
  const selection = useMessageSelection(bubbleRows, currentUserId);
  const menu = useMessageMenu<ChatListRow>(measureList);

  // Без «Ответить» сообщение — ответ на исходное. Корень удалён — на самый
  // новый ответ: он в этом же треде.
  const defaultQuotes = useCallback((): LiveQuote[] => {
    const target = root && !root.chatThreadDeletedRoot ? root : newestReply;

    return target ? [quoteOf(target, authorName(target.authorId))] : [];
  }, [authorName, newestReply, root]);

  // Плашка корня в «Тредах» меняется сразу, не дожидаясь сервера.
  const bump = useCallback(
    (quotes: LiveQuote[], content: SentContent) => {
      if (!me) return;

      const roots = chatThreadRootsOf(queryClient, quotes);

      if (roots.length > 0) {
        bumpChatThreadSummaries(queryClient, chatId, roots, me, sentPreview(content));
      }
    },
    [chatId, me, queryClient],
  );

  const { send: sendToChat, sendVoice: sendVoiceToChat } = kit;
  const send = useCallback(
    (text: string, media?: OutgoingMedia[], replies?: LiveQuote[], hidden?: HiddenRange[]) => {
      const quotes = replies?.length ? replies : defaultQuotes();

      sendToChat(text, media, quotes, hidden);
      bump(quotes, { kind: media?.length ? 'media' : 'text', text, media });
    },
    [bump, defaultQuotes, sendToChat],
  );
  const sendVoice = useCallback(
    (voice: LocalMedia, replies?: LiveQuote[]) => {
      const quotes = replies?.length ? replies : defaultQuotes();

      sendVoiceToChat(voice, quotes);
      bump(quotes, { kind: 'voice', text: '', durationMs: voice.durationMs });
    },
    [bump, defaultQuotes, sendVoiceToChat],
  );

  const replyForward = useReplyForward({
    chatId,
    sourceChat: kit.sourceChat,
    draft,
    authorName,
    originalOf: kit.originalOf,
    composerRef,
    send,
    sendVoice,
    draftKey,
    ownWindow: true,
  });
  const edit = useMessageEdit({
    chatId: draftKey,
    draft,
    composerRef,
    saveEdit: kit.saveEdit,
    ownWindow: true,
  });
  const { leave: leaveEdit, start: beginEdit } = edit;
  const isEditing = edit.mode !== null;

  const afterEdit = useCallback(
    (next: () => void) => {
      if (readChatDraft(draftKey).mode?.type !== 'edit') {
        next();
        return;
      }

      void leaveEdit().then((left) => {
        if (left) next();
      });
    },
    [draftKey, leaveEdit],
  );

  const { startReply: beginReply, startForward } = replyForward;
  const startReply = useCallback(
    (rows: BubbleRow[]) => afterEdit(() => beginReply(rows)),
    [afterEdit, beginReply],
  );
  const startEdit = useCallback(
    (message: ChatMessage) => afterEdit(() => beginEdit(message)),
    [afterEdit, beginEdit],
  );
  // Выбор чата — экраном под окнами: шторка уходит, чтобы он был виден.
  const forward = useCallback(
    (rows: BubbleRow[]) => {
      close();
      startForward(rows);
    },
    [close, startForward],
  );
  const comment = useCallback(
    (row: BubbleRow) => {
      const message = contentOf(row);

      if (message) openComments(message.id, chatId, isMember);
    },
    [chatId, isMember],
  );
  const { showInChat: showInChatOf } = kit;
  const showInChat = useCallback(
    (row: BubbleRow) => {
      const message = contentOf(row);

      if (!message) return;

      close();
      showInChatOf(row.key, message.seq);
    },
    [close, showInChatOf],
  );

  const { runMessageAction, runSelectionAction } = useMessageActionHandlers({
    currentUserId,
    selection,
    pins: kit.pins,
    retry: kit.retry,
    discard: kit.discard,
    deleteMessages: kit.deleteMessages,
    removeFromIsland: kit.removeFromIsland,
    authorName,
    reply: startReply,
    comment,
    forward,
    edit: startEdit,
    openOriginal: kit.navigation.openOriginal,
    openChat: kit.navigation.openChat,
    showInChat,
  });

  const menuRow = menu.target?.item ?? null;
  const menuContent = menuRow && menuRow.type !== 'island-header' ? contentOf(menuRow) : null;
  const { pins, reactions } = kit;
  const menuActions = useMemo(() => {
    if (!menuRow || menuRow.type === 'island-header' || !menuContent) return [];

    return visibleMessageActions({
      message: menuContent,
      isOwn: menuContent.authorId === currentUserId,
      isMember,
      isPinned: pins.isPinned(menuContent.id),
      selectable: isSelectableRow(menuRow, currentUserId),
      inChatThread: true,
    });
  }, [currentUserId, isMember, menuContent, menuRow, pins]);

  const { toggle: toggleReaction, audience } = reactions;
  const menuReactions = useMemo(() => {
    if (!menuContent || !canReactTo(menuContent)) return null;

    return {
      ...menuReactionSet(menuContent.reactions, audience),
      selected: menuContent.reactions.mine?.emoji ?? null,
      onSelect: (emoji: string) => toggleReaction(menuContent, emoji, audience),
    };
  }, [audience, menuContent, toggleReaction]);

  const runMenuAction = useCallback(
    (id: string) => {
      if (menuRow && menuRow.type !== 'island-header') runMessageAction(id as MessageActionId, menuRow);
    },
    [menuRow, runMessageAction],
  );

  return {
    draft,
    composerRef,
    selection,
    menu,
    menuRow,
    menuContent,
    menuActions,
    menuReactions,
    runMenuAction,
    runSelectionAction,
    startReply,
    edit,
    isEditing,
    submit: isEditing ? edit.save : replyForward.submit,
    sendVoice: isEditing ? edit.recorded : replyForward.sendVoice,
  };
}
