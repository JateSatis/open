import { forwardRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { styles } from './styles';
import { useStickyCheck, type StickyFrame } from './useStickyCheck';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage, SavedTag } from '@/api/saved';
import { Avatar } from '@/components/Avatar';
import { SelectionCheck } from '@/components/SelectionCheck';
import { Text } from '@/components/Text';
import { chatAvatarUrl } from '@/features/chats/chatDisplay';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { describePreview, previewOf } from '@/features/chats/messageQuote';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { isNote, savedSourceLabel, toBubbleMessage } from '@/features/saved/savedCopy';
import { savedSearchText } from '@/features/saved/savedSearchText';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches, normalizeSearch, snippetAround } from '@/features/search/searchText';
import { formatDayMonth } from '@/lib/dates';
import { Opacity, Sizes } from '@/theme';

export type WatchLaterRowBodyProps = {
  saved: SavedMessage;
  /** Чаты-источники — для подписи записи и её цитат. */
  chats: ReadonlyMap<string, ChatSummary>;
  currentUserId: string | null;
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
  expanded: boolean;
  onToggleExpanded?: () => void;
  onToggleDone?: () => void;
  onOpenSource: (saved: SavedMessage) => void;
  /** Прокрутка списка — для чекбокса у раскрытого пузыря. Нет — чекбокс стоит у верха. */
  sticky?: StickyFrame | null;
  /** Обёртка пузыря — жесты строки вокруг него (свайп ждёт перемотку голосового). */
  wrapBubble?: (bubble: ReactNode) => ReactNode;
  /** Запрос поиска: превью — фрагментом с подсвеченным совпадением. */
  searched?: string;
  /** Тап по тегу на раскрытом пузыре — фильтр по нему. */
  onTagPress?: (tagId: string) => void;
};

/**
 * Вид строки «Посмотреть позже»: слева дата добавления, аватар и название
 * источника, под ними превью одной строкой; справа — чекбокс. Раскрытая —
 * ещё «сохранено дд.ММ» и полный пузырь, чекбокс — у пузыря. Выполненная —
 * бледная.
 */
export const WatchLaterRowBody = forwardRef<View, WatchLaterRowBodyProps>(
  function WatchLaterRowBody(
    {
      saved,
      chats,
      currentUserId,
      tagsById,
      mediaBounds,
      expanded,
      onToggleExpanded,
      onToggleDone,
      onOpenSource,
      sticky = null,
      wrapBubble = (bubble) => bubble,
      searched = '',
      onTagPress,
    },
    ref,
  ) {
    const chat = saved.sourceChatId ? chats.get(saved.sourceChatId) : undefined;
    const label = savedSourceLabel(saved, chat, currentUserId);
    const note = isNote(saved);
    const done = saved.watchDoneAt !== null;
    const { bubbleRef, checkStyle, onBubbleLayout } = useStickyCheck(sticky, expanded);
    const preview = describePreview(previewOf(toBubbleMessage(saved)));
    const needle = normalizeSearch(searched);
    const found = needle === '' ? null : savedSearchText(saved, needle);
    const snippet = found === null ? null : snippetAround(found, findMatches(found, needle));

    const check = (
      <Pressable
        testID={`watch-later-check-${saved.id}`}
        accessibilityRole="checkbox"
        accessibilityLabel={done ? 'Просмотрено' : 'Не просмотрено'}
        accessibilityState={{ checked: done }}
        onPress={onToggleDone}
        hitSlop={Sizes.selectionCheck / 2}
      >
        <SelectionCheck checked={done} />
      </Pressable>
    );

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[styles.body, done && { opacity: Opacity.watchDone }]}
      >
        <Pressable
          testID={`watch-later-row-${saved.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${label.source}: ${preview}`}
          accessibilityState={{ expanded }}
          onPress={onToggleExpanded}
          style={styles.header}
        >
          <Text variant="caption" color="textSecondary" style={styles.date}>
            {saved.watchLaterAt ? formatDayMonth(saved.watchLaterAt) : ''}
          </Text>
          <Avatar
            uri={note ? label.avatarUrl : chat ? chatAvatarUrl(chat, currentUserId) : null}
            name={note ? label.avatarName : label.source}
            size={Sizes.chatListAvatar}
          />
          <View style={styles.titles}>
            <Text variant="bodyBold" numberOfLines={1}>
              {label.source}
            </Text>
            {expanded ? null : snippet ? (
              <HighlightedText
                variant="small"
                color="textSecondary"
                numberOfLines={1}
                ranges={snippet.ranges}
              >
                {snippet.text}
              </HighlightedText>
            ) : (
              <Text variant="small" color="textSecondary" numberOfLines={1}>
                {preview}
              </Text>
            )}
          </View>
          {expanded ? null : check}
        </Pressable>

        {expanded ? (
          <Animated.View entering={FadeIn} style={styles.details}>
            <Text variant="caption" color="textSecondary">
              {`${note ? 'написано' : 'сохранено'} ${formatDayMonth(saved.savedAt)}`}
            </Text>
            <View style={styles.expandedRow}>
              <Animated.View ref={bubbleRef} onLayout={onBubbleLayout} style={styles.bubble}>
                {wrapBubble(
                  <SavedBubble
                    saved={saved}
                    chats={chats}
                    currentUserId={currentUserId}
                    tagsById={tagsById}
                    mediaBounds={mediaBounds}
                    onOpenSource={onOpenSource}
                    hideWatchLater
                    onTagPress={onTagPress ? (tagId) => onTagPress(tagId) : undefined}
                  />,
                )}
              </Animated.View>
              <View style={styles.checkColumn}>
                <Animated.View style={checkStyle}>{check}</Animated.View>
              </View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    );
  },
);
