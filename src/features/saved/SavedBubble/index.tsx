import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary, QuotedMessage } from '@/api/chats';
import type { SavedMessage, SavedTag } from '@/api/saved';
import { SelectionCheck } from '@/components/SelectionCheck';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { SavedLead } from '@/features/saved/SavedLead';
import {
  isNote,
  savedQuotesOf,
  savedSourceLabel,
  toBubbleMessage,
  type SavedItem,
} from '@/features/saved/savedCopy';

export type SavedBubbleProps = {
  saved: SavedItem;
  /** Чаты-источники — для подписи записи и её цитат. */
  chats: ReadonlyMap<string, ChatSummary>;
  currentUserId: string | null;
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
  onOpenSource: (saved: SavedMessage) => void;
  /** Тап по цитате заметки — к цитируемой записи. Нет — цитаты не нажимаются. */
  onQuotePress?: (savedId: string, seq: number) => void;
  /** Тап по «не отправлено» у своей заметки. */
  onRetry?: (localId: string) => void;
  /** Без кружка «Посмотреть позже» в углу: на своей вкладке у строки свой чекбокс. */
  hideWatchLater?: boolean;
};

const QUOTE_DELETED = 'Запись удалена';

/**
 * Сохранённое — облачком переписки, слева, в исходном виде: текст, медиа,
 * голосовое, пост с попом, комментарий. Своя заметка — так же, сверху «Вы»,
 * над текстом — цитаты, на которые она отвечает. Реакций, комментариев и
 * просмотров нет; медиа открывается, голосовое играет.
 */
export const SavedBubble = memo(function SavedBubble({
  saved,
  chats,
  currentUserId,
  tagsById,
  mediaBounds,
  onOpenSource,
  onQuotePress,
  onRetry,
  hideWatchLater = false,
}: SavedBubbleProps) {
  const chat = saved.sourceChatId ? chats.get(saved.sourceChatId) : undefined;
  const message = useMemo(
    () => toBubbleMessage(saved, savedQuotesOf(saved, chats, currentUserId)),
    [chats, currentUserId, saved],
  );
  const label = savedSourceLabel(saved, chat, currentUserId);
  const tags = saved.tagIds.flatMap((id) => tagsById.get(id) ?? []);
  const watchLater = saved.watchLaterAt !== null && !hideWatchLater;
  const note = isNote(saved);
  const openQuote = onQuotePress
    ? (quote: QuotedMessage) => {
        if (quote.state === 'live') onQuotePress(quote.messageId, quote.seq);
      }
    : undefined;

  return (
    <View testID={`saved-row-${saved.id}`} style={styles.row}>
      <MessageBubble
        message={message}
        isOwn={false}
        isRead={false}
        receipts={false}
        authorName={label.avatarName}
        authorAvatarUrl={label.avatarUrl}
        mediaBounds={mediaBounds}
        showAuthor={false}
        showViews={false}
        untracked
        onRetry={onRetry}
        onQuotePress={openQuote}
        quoteDeletedText={QUOTE_DELETED}
        lead={
          <SavedLead
            label={label}
            isComment={saved.sourceType === 'comment'}
            tags={tags}
            onOpenSource={note ? undefined : () => onOpenSource(saved)}
          />
        }
        corner={
          watchLater ? (
            <SelectionCheck
              testID="saved-watch-later"
              accessibilityLabel="Посмотреть позже"
              checked={saved.watchDoneAt !== null}
              size="small"
            />
          ) : undefined
        }
      />
    </View>
  );
});
