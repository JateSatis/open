import { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';
import { SavedSelectionBar } from './SavedSelectionBar';
import { useSavedPinBar } from './useSavedPinBar';

import type { SavedMessage, SavedTag } from '@/api/saved';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageRow } from '@/features/chats/MessageRow';
import { PinnedBar } from '@/features/chats/PinnedBar';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { SavedListState } from '@/features/saved/SavedListState';
import { SavedMenu } from '@/features/saved/SavedMenu';
import { useOpenSavedSource } from '@/features/saved/useOpenSavedSource';
import { useSavedItemActions } from '@/features/saved/useSavedItemActions';
import { useSavedJump } from '@/features/saved/useSavedJump';
import { useSavedMenu } from '@/features/saved/useSavedMenu';
import { useSavedMessages } from '@/features/saved/useSavedMessages';
import { useSavedSelection } from '@/features/saved/useSavedSelection';

/** Догрузка начинается, когда до края осталось столько экранов. */
const HISTORY_EDGE = 1;

const EMPTY = {
  testID: 'saved-empty',
  title: 'Здесь пока пусто',
  hint: 'Чтобы сохранить сообщение или комментарий, нажмите «Переслать» и выберите «★ Сохранённые сообщения». Сохранённое видите только вы.',
};

export type SavedAllTabProps = {
  currentUserId: string | null;
  tags: SavedTag[];
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
  /** Вкладка видна: ушли на другую — выбор снимается. */
  active: boolean;
};

/**
 * Вкладка «Все»: сохранённое — как переписка, пузыри слева, новые внизу,
 * старые догружаются прокруткой вверх. Под переключателем — полоса
 * закрепов. Долгое нажатие — меню с тегами, «Выбрать» — выбор с панелью.
 */
export function SavedAllTab({
  currentUserId,
  tags,
  tagsById,
  mediaBounds,
  active,
}: SavedAllTabProps) {
  const saved = useSavedMessages();
  const openSource = useOpenSavedSource();
  const listRef = useRef<FlatList<SavedMessage> | null>(null);
  const selection = useSavedSelection(saved.items, active);
  const jump = useSavedJump(listRef, saved.items, saved.loadAround);
  const pinBar = useSavedPinBar(jump.jump);
  const {
    frameRef,
    target: menuTarget,
    viewport: menuViewport,
    saved: menuSaved,
    open: openMenu,
    close: closeMenu,
  } = useSavedMenu(saved.items, 'all');
  const { start: startSelection } = selection;
  const handlers = useSavedItemActions({
    chats: saved.chats,
    currentUserId,
    onSelect: useCallback((item: SavedMessage) => startSelection(item.id), [startSelection]),
  });

  const bubble = useCallback(
    (item: SavedMessage) => (
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

  const { active: selecting, isSelected, toggle } = selection;
  const { highlight } = jump;
  const renderItem = useCallback(
    ({ item }: { item: SavedMessage }) => (
      <MessageRow
        messageId={item.id}
        selectionMode={selecting}
        selectable
        selected={isSelected(item.id)}
        highlightKey={highlight?.id === item.id ? highlight.key : null}
        onOpenMenu={(anchor) => openMenu(item, anchor)}
        onToggle={() => toggle(item.id)}
      >
        {bubble(item)}
      </MessageRow>
    ),
    [bubble, highlight, isSelected, openMenu, selecting, toggle],
  );

  const state = (
    <SavedListState
      failed={saved.failed}
      loading={saved.isLoading}
      empty={saved.items.length === 0 ? EMPTY : null}
      onRetry={saved.reload}
      failText="Не удалось загрузить сохранённое"
      loadingLabel="Загрузка сохранённого"
    />
  );

  if (saved.failed || saved.isLoading || saved.items.length === 0) return state;

  return (
    <View style={styles.flex}>
      <PinnedBar pins={pinBar.pins} index={pinBar.index} onPress={pinBar.open} />

      <View ref={frameRef} collapsable={false} style={styles.flex}>
        <FlatList
          ref={listRef}
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
          // Окно вокруг закрепа: внизу — более новые, догружаются у низа.
          onStartReached={saved.hasNewer ? saved.loadNewer : undefined}
          onStartReachedThreshold={HISTORY_EDGE}
          maintainVisibleContentPosition={saved.hasNewer ? { minIndexForVisible: 0 } : undefined}
          onScrollToIndexFailed={jump.onScrollToIndexFailed}
          ListFooterComponent={
            saved.isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка" /> : null
          }
        />
      </View>

      {selecting ? (
        <SavedSelectionBar
          selected={selection.selected}
          onCopy={handlers.copy}
          onForward={handlers.forward}
          onDelete={handlers.removeConfirmed}
          onDone={selection.clear}
        />
      ) : null}

      <SavedMenu
        target={menuTarget}
        saved={menuSaved}
        viewport={menuViewport}
        preview={menuSaved ? bubble(menuSaved) : null}
        previewGrowth="up"
        tags={tags}
        actions={handlers.actions}
        onAction={handlers.run}
        onClose={closeMenu}
      />
    </View>
  );
}
