import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, View, useWindowDimensions } from 'react-native';

import { styles } from './styles';

import type { SavedMessage } from '@/api/saved';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { useOpenSavedSource } from '@/features/saved/useOpenSavedSource';
import { useSavedMessages } from '@/features/saved/useSavedMessages';
import { useSavedTags } from '@/features/saved/useSavedTags';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Догрузка старых начинается, когда до верха осталось столько экранов. */
const HISTORY_EDGE = 1;

/**
 * «Сохранённые сообщения», вкладка «Все»: сохранённое — как переписка, все
 * пузыри слева, новые внизу, экран открывается в самом низу, старые
 * догружаются прокруткой вверх. Над списком — место под переключатель
 * «Все | Посмотреть позже», поиск и фильтры (следующие этапы).
 */
export function SavedScreen() {
  const theme = useTheme();
  const currentUserId = useCurrentUserId();
  const { width: windowWidth } = useWindowDimensions();
  const saved = useSavedMessages();
  const { tags } = useSavedTags();
  const openSource = useOpenSavedSource();
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const mediaBounds = useMemo(
    () => mosaicBounds(windowWidth - Spacing.three * 2, false, bubbleAsideWidth(true)),
    [windowWidth],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedMessage }) => (
      <SavedBubble
        saved={item}
        chat={item.sourceChatId ? saved.chats.get(item.sourceChatId) : undefined}
        currentUserId={currentUserId}
        tagsById={tagsById}
        mediaBounds={mediaBounds}
        onOpenSource={openSource}
      />
    ),
    [currentUserId, mediaBounds, openSource, saved.chats, tagsById],
  );

  return (
    <View testID="saved-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      {saved.failed ? (
        <LoadFailed message="Не удалось загрузить сохранённое" onRetry={saved.reload} />
      ) : saved.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel="Загрузка сохранённого" />
        </View>
      ) : saved.items.length === 0 ? (
        <View testID="saved-empty" style={styles.centered}>
          <Text variant="bodyBold">Здесь пока пусто</Text>
          <Text color="textSecondary" style={styles.hint}>
            Чтобы сохранить сообщение или комментарий, нажмите «Переслать» и выберите «★
            Сохранённые сообщения». Сохранённое видите только вы.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="saved-list"
          inverted
          data={saved.items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={saved.chats}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          // Список перевёрнут: его «конец» — верх экрана, там старое.
          onEndReached={saved.hasMore ? saved.loadMore : undefined}
          onEndReachedThreshold={HISTORY_EDGE}
          ListFooterComponent={
            saved.isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка" /> : null
          }
        />
      )}
    </View>
  );
}
