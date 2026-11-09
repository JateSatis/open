import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { styles } from './styles';
import { SavedSelectionBar } from './SavedSelectionBar';
import { useSavedPinBar } from './useSavedPinBar';
import { useSavedSearch } from './useSavedSearch';

import type { SavedFilterInput, SavedMessage, SavedTag } from '@/api/saved';
import { ChatSearchPlate } from '@/features/chats/chatSearch/ChatSearchPlate';
import type { MosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageRow } from '@/features/chats/MessageRow';
import { PinnedBar } from '@/features/chats/PinnedBar';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { usePendingNotes } from '@/features/saved/notesStore';
import { SavedBubble } from '@/features/saved/SavedBubble';
import { SavedComposer } from '@/features/saved/SavedComposer';
import { addFilterTag, resetSavedFilters } from '@/features/saved/savedFiltersStore';
import { isPendingNote, type SavedItem } from '@/features/saved/savedCopy';
import { SavedListState } from '@/features/saved/SavedListState';
import { SavedMenu } from '@/features/saved/SavedMenu';
import { SavedSearchResults } from '@/features/saved/SavedSearchResults';
import type { SavedComposerState } from '@/features/saved/useSavedComposer';
import { useSavedItemActions } from '@/features/saved/useSavedItemActions';
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

const NOTHING_FOUND = {
  testID: 'saved-filter-empty',
  title: 'Ничего не найдено',
  action: { label: 'Сбросить фильтры', onPress: resetSavedFilters, testID: 'saved-filter-empty-reset' },
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
  /** Фильтры экрана: список, закрепы и поиск — только подходящее. */
  filter: { input: SavedFilterInput | null; key: string | null; active: boolean };
  /** Запрос поиска; `null` — поиск закрыт. */
  search: string | null;
  /** Справа в шапке вне выбора — поиск и фильтры экрана. */
  headerRight: () => ReactNode;
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
  filter,
  search,
  headerRight,
}: SavedAllTabProps) {
  const saved = useSavedMessages(filter);
  const pending = usePendingNotes();
  const items: SavedItem[] = useMemo(() => {
    // Подтверждённая заметка на миг лежит и там и там — под одним id.
    const loaded = new Set(saved.items.map((item) => item.id));

    return [...pending.filter((note) => !loaded.has(note.id)), ...saved.items];
  }, [pending, saved.items]);
  const {
    containerRef: keyboardRef,
    onLayout: measureKeyboardArea,
    style: keyboardStyle,
  } = useChatKeyboardInset();
  const selection = useSavedSelection(items, active, headerRight);
  const pinBar = useSavedPinBar(filter);
  const matches = useSavedSearch(search, active, filter);
  const [resultsShown, setResultsShown] = useState(false);
  const searching = search !== null;

  // Поиск закрыли — следующий откроется с переписки, а не со списка найденного.
  if (!searching && resultsShown) setResultsShown(false);
  const showResults = searching && resultsShown;
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
  const bubble = useCallback(
    (item: SavedItem) => (
      <SavedBubble
        saved={item}
        chats={saved.chats}
        currentUserId={currentUserId}
        tagsById={tagsById}
        mediaBounds={mediaBounds}
        onRetry={retry}
        onTagPress={addFilterTag}
      />
    ),
    [currentUserId, mediaBounds, retry, saved.chats, tagsById],
  );

  const { active: selecting, isSelected, toggle } = selection;
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
          onOpenMenu={(anchor) => openMenu(item, anchor)}
          onToggle={() => toggle(item.id)}
          // Во время правки ответ свайпом заменил бы её и потерял отложенный черновик.
          onSwipeReply={pendingNote || editingId !== null ? undefined : () => reply([item])}
        >
          {bubble(item)}
        </MessageRow>
      );
    },
    [bubble, editingId, isSelected, openMenu, reply, selecting, toggle],
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
            empty={empty ? (filter.active ? NOTHING_FOUND : EMPTY) : null}
            onRetry={saved.reload}
            failText="Не удалось загрузить сохранённое"
            loadingLabel="Загрузка сохранённого"
          />
        </View>
      )}

      {showResults ? (
        <SavedSearchResults
          search={matches}
          chats={saved.chats}
          currentUserId={currentUserId}
        />
      ) : null}

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
      <View style={selecting || searching ? styles.hidden : undefined}>
        <SavedComposer composer={composer} />
      </View>

      {searching && !selecting ? (
        <ChatSearchPlate
          search={matches}
          showingList={showResults}
          onToggleList={() => setResultsShown((shown) => !shown)}
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
    </Animated.View>
  );
}
