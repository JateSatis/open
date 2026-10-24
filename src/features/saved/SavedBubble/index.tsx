import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage, SavedTag } from '@/api/saved';
import { SelectionCheck } from '@/components/SelectionCheck';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { SavedLead } from '@/features/saved/SavedLead';
import { savedSourceLabel, toBubbleMessage } from '@/features/saved/savedCopy';

export type SavedBubbleProps = {
  saved: SavedMessage;
  chat: ChatSummary | undefined;
  currentUserId: string | null;
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
  onOpenSource: (saved: SavedMessage) => void;
  /** Без кружка «Посмотреть позже» в углу: на своей вкладке у строки свой чекбокс. */
  hideWatchLater?: boolean;
};

/**
 * Сохранённое — облачком переписки, слева, в исходном виде: текст, медиа,
 * голосовое, пост с попом, комментарий. Реакций, комментариев, просмотров и
 * ответа свайпом нет; медиа открывается, голосовое играет.
 */
export const SavedBubble = memo(function SavedBubble({
  saved,
  chat,
  currentUserId,
  tagsById,
  mediaBounds,
  onOpenSource,
  hideWatchLater = false,
}: SavedBubbleProps) {
  const message = useMemo(() => toBubbleMessage(saved), [saved]);
  const label = savedSourceLabel(saved, chat, currentUserId);
  const tags = saved.tagIds.flatMap((id) => tagsById.get(id) ?? []);
  const watchLater = saved.watchLaterAt !== null && !hideWatchLater;

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
        lead={
          <SavedLead
            label={label}
            isComment={saved.sourceType === 'comment'}
            tags={tags}
            onOpenSource={() => onOpenSource(saved)}
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
