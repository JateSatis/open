import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';
import { useSavedPinBar } from './useSavedPinBar';

import type { SavedMessage, SavedTag } from '@/api/saved';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import type { AnchorRect, MenuAnchor } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import { PinnedBar } from '@/features/chats/PinnedBar';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { SAVED_SELECTION_ACTIONS } from '@/features/saved/savedActions';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { SavedMenu, type SavedMenuTarget } from '@/features/saved/SavedMenu';
import { useOpenSavedSource } from '@/features/saved/useOpenSavedSource';
import { useSavedItemActions } from '@/features/saved/useSavedItemActions';
import { useSavedJump } from '@/features/saved/useSavedJump';
import { useSavedMessages } from '@/features/saved/useSavedMessages';
import { useSavedSelection } from '@/features/saved/useSavedSelection';
import { Spacing } from '@/theme';

/** Догрузка начинается, когда до края осталось столько экранов. */
const HISTORY_EDGE = 1;

export type SavedAllTabProps = {
  currentUserId: string | null;
  tags: SavedTag[];
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
};

/**
 * Вкладка «Все»: сохранённое — как переписка, пузыри слева, новые внизу,
 * старые догружаются прокруткой вверх. Под переключателем — полоса
 * закрепов. Долгое нажатие — меню с тегами, «Выбрать» — выбор с панелью.
 */
export function SavedAllTab({ currentUserId, tags, tagsById, mediaBounds }: SavedAllTabProps) {
  const insets = useSafeAreaInsets();
  const saved = useSavedMessages();
  const openSource = useOpenSavedSource();
  const listRef = useRef<FlatList<SavedMessage> | null>(null);
  const frameRef = useRef<View | null>(null);
  const selection = useSavedSelection(saved.items);
  const jump = useSavedJump(listRef, saved.items, saved.loadAround);
  const pinBar = useSavedPinBar(jump.jump);
  const { start: startSelection } = selection;
  const handlers = useSavedItemActions({
    chats: saved.chats,
    currentUserId,
    onSelect: useCallback((item: SavedMessage) => startSelection(item.id), [startSelection]),
  });
  const [menu, setMenu] = useState<SavedMenuTarget | null>(null);
  const [viewport, setViewport] = useState<AnchorRect | null>(null);
  const menuSaved = useMemo(
    () => (menu ? (saved.items.find((item) => item.id === menu.savedId) ?? null) : null),
    [menu, saved.items],
  );

  const openMenu = useCallback((item: SavedMessage, anchor: MenuAnchor) => {
    frameRef.current?.measureInWindow((x, y, width, height) =>
      setViewport({ x, y, width, height }),
    );
    setMenu({ savedId: item.id, anchor, tab: 'all' });
  }, []);

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
  const highlight = jump.highlight;
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

  const runSelection = (id: string) => {
    const picked = selection.selected;

    if (id === 'copy') {
      handlers.copy(picked);
      selection.clear();
    } else if (id === 'forward') {
      void handlers.forward(picked).then((opened) => {
        if (opened) selection.clear();
      });
    } else if (id === 'delete') {
      void handlers.removeConfirmed(picked.map((item) => item.id)).then((removed) => {
        if (removed) selection.clear();
      });
    }
  };

  if (saved.failed) {
    return <LoadFailed message="Не удалось загрузить сохранённое" onRetry={saved.reload} />;
  }

  if (saved.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка сохранённого" />
      </View>
    );
  }

  if (saved.items.length === 0) {
    return (
      <View testID="saved-empty" style={styles.centered}>
        <Text variant="bodyBold">Здесь пока пусто</Text>
        <Text color="textSecondary" style={styles.hint}>
          Чтобы сохранить сообщение или комментарий, нажмите «Переслать» и выберите «★ Сохранённые
          сообщения». Сохранённое видите только вы.
        </Text>
      </View>
    );
  }

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
        <View style={{ paddingBottom: Math.max(insets.bottom, Spacing.two) }}>
          <SelectionActionBar
            context={{ selected: selection.selected }}
            actions={SAVED_SELECTION_ACTIONS}
            onAction={runSelection}
          />
        </View>
      ) : null}

      <SavedMenu
        target={menu}
        saved={menuSaved}
        viewport={viewport}
        preview={menuSaved ? bubble(menuSaved) : null}
        previewGrowth="up"
        tags={tags}
        actions={handlers.actions}
        onAction={handlers.run}
        onClose={() => setMenu(null)}
      />
    </View>
  );
}
