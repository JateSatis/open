import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { styles } from './styles';
import { SavedSelectionBar } from './SavedSelectionBar';
import { useSavedPinBar } from './useSavedPinBar';

import type { SavedMessage, SavedTag } from '@/api/saved';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageRow } from '@/features/chats/MessageRow';
import { PinnedBar } from '@/features/chats/PinnedBar';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { usePendingNotes } from '@/features/saved/notesStore';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { SavedComposer } from '@/features/saved/SavedComposer';
import { isPendingNote, type SavedItem } from '@/features/saved/savedCopy';
import { SavedListState } from '@/features/saved/SavedListState';
import { SavedMenu } from '@/features/saved/SavedMenu';
import type { SavedComposerState } from '@/features/saved/useSavedComposer';
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
  hint: 'Напишите заметку внизу или сохраните сообщение: «Переслать» → «★ Сохранённые сообщения». Сохранённое и заметки видите только вы.',
};

export type SavedAllTabProps = {
  currentUserId: string | null;
  tags: SavedTag[];
  tagsById: ReadonlyMap<string, SavedTag>;
  mediaBounds: MosaicBounds;
  /** Вкладка видна: ушли на другую — выбор снимается. */
  active: boolean;
  /** Поле заметок — экрана: «Ответить» с другой вкладки попадает сюда же. */
  composer: SavedComposerState;
};

/**
 * Вкладка «Все»: сохранённое и свои заметки — как переписка, пузыри слева,
 * новые внизу, старые догружаются прокруткой вверх. Под переключателем —
 * полоса закрепов, внизу — поле заметок, в выборе на его месте — панель.
 * Долгое нажатие — меню с тегами, свайп влево — ответ.
 */
export function SavedAllTab({
  currentUserId,
  tags,
  tagsById,
  mediaBounds,
  active,
  composer,
}: SavedAllTabProps) {
  const saved = useSavedMessages();
  const pending = usePendingNotes();
  const items: SavedItem[] = useMemo(() => {
    // Подтверждённая заметка на миг лежит и там и там — под одним id.
    const loaded = new Set(saved.items.map((item) => item.id));

    return [...pending.filter((note) => !loaded.has(note.id)), ...saved.items];
  }, [pending, saved.items]);
  const openSource = useOpenSavedSource();
  const {
    containerRef: keyboardRef,
    onLayout: measureKeyboardArea,
    style: keyboardStyle,
  } = useChatKeyboardInset();
  const listRef = useRef<FlatList<SavedItem> | null>(null);
  const selection = useSavedSelection(items, active);
  const jump = useSavedJump(listRef, items, saved.loadAround);
  const pinBar = useSavedPinBar(jump.jump);
  const {
    frameRef,
    target: menuTarget,
    viewport: menuViewport,
    saved: menuSaved,
    open: openMenu,
    close: closeMenu,
  } = useSavedMenu(items, 'all');
  const { start: startSelection } = selection;
  const { startReply, startEdit, retry } = composer;
  const reply = useCallback(
    (list: SavedMessage[]) => startReply(list, saved.chats),
    [saved.chats, startReply],
  );
  const handlers = useSavedItemActions({
    chats: saved.chats,
    currentUserId,
    onSelect: useCallback((item: SavedMessage) => startSelection(item.id), [startSelection]),
    onReply: reply,
    onEdit: startEdit,
    onRetry: retry,
  });
  const { jump: jumpTo } = jump;
  const openQuote = useCallback((id: string, seq: number) => void jumpTo(id, seq), [jumpTo]);

  const bubble = useCallback(
    (item: SavedItem) => (
      <SavedBubble
        saved={item}
        chats={saved.chats}
        currentUserId={currentUserId}
        tagsById={tagsById}
        mediaBounds={mediaBounds}
        onOpenSource={openSource}
        onQuotePress={openQuote}
        onRetry={retry}
      />
    ),
    [currentUserId, mediaBounds, openQuote, openSource, retry, saved.chats, tagsById],
  );

  const { active: selecting, isSelected, toggle } = selection;
  const { highlight } = jump;
  const editingId = composer.edit.mode?.message.id ?? null;
  const renderItem = useCallback(
    ({ item }: { item: SavedItem }) => {
      const pendingNote = isPendingNote(item);

      return (
        <MessageRow
          messageId={item.id}
          selectionMode={selecting}
          selectable={!pendingNote}
          selected={isSelected(item.id)}
          editing={editingId === item.id}
          highlightKey={highlight?.id === item.id ? highlight.key : null}
          onOpenMenu={(anchor) => openMenu(item, anchor)}
          onToggle={() => toggle(item.id)}
          // Во время правки ответ свайпом заменил бы её и потерял отложенный черновик.
          onSwipeReply={pendingNote || editingId !== null ? undefined : () => reply([item])}
        >
          {bubble(item)}
        </MessageRow>
      );
    },
    [bubble, editingId, highlight, isSelected, openMenu, reply, selecting, toggle],
  );

  const empty = items.length === 0;
  const showList = !saved.failed && !saved.isLoading && !empty;

  return (
    <Animated.View
      ref={keyboardRef}
      onLayout={measureKeyboardArea}
      style={[styles.flex, keyboardStyle]}
    >
      {showList ? (
        <>
          <PinnedBar pins={pinBar.pins} index={pinBar.index} onPress={pinBar.open} />

          <View ref={frameRef} collapsable={false} style={styles.flex}>
            <FlatList
              ref={listRef}
              testID="saved-list"
              inverted
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              extraData={saved.chats}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.list}
              // Тап по облачку при открытой клавиатуре сразу открывает меню.
              keyboardShouldPersistTaps="handled"
              // Список перевёрнут: его «конец» — верх экрана, там старое.
              onEndReached={saved.hasMore ? saved.loadMore : undefined}
              onEndReachedThreshold={HISTORY_EDGE}
              // Окно вокруг закрепа: внизу — более новые, догружаются у низа.
              onStartReached={saved.hasNewer ? saved.loadNewer : undefined}
              onStartReachedThreshold={HISTORY_EDGE}
              maintainVisibleContentPosition={
                saved.hasNewer ? { minIndexForVisible: 0 } : undefined
              }
              onScrollToIndexFailed={jump.onScrollToIndexFailed}
              ListFooterComponent={
                saved.isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка" /> : null
              }
            />
          </View>
        </>
      ) : (
        <View style={styles.flex}>
          <SavedListState
            failed={saved.failed}
            loading={saved.isLoading}
            empty={empty ? EMPTY : null}
            onRetry={saved.reload}
            failText="Не удалось загрузить сохранённое"
            loadingLabel="Загрузка сохранённого"
          />
        </View>
      )}

      {selecting ? (
        <SavedSelectionBar
          selected={selection.selected}
          onReply={reply}
          onCopy={handlers.copy}
          onForward={handlers.forward}
          onDelete={handlers.removeConfirmed}
          onDone={selection.clear}
        />
      ) : null}

      {/* На время выбора поле прячется, а не размонтируется: черновик и
          подготовленный рекордер голосовых остаются как были. */}
      <View style={selecting ? styles.hidden : undefined}>
        <SavedComposer composer={composer} />
      </View>

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
    </Animated.View>
  );
}
