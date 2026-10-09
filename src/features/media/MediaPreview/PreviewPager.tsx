import { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { LiveAdjust } from './EditedPhoto';
import { PreviewPage, type PreviewMotion } from './PreviewPage';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';

export type PreviewPagerProps = {
  gallery: MediaLibraryItem[];
  index: number;
  width: number;
  height: number;
  cellSize: number;
  motion: PreviewMotion;
  /** Ползунки открытого инструмента цвета — у активной страницы. */
  live: LiveAdjust | null;
  /** Открыт инструмент: листать нельзя. */
  locked: boolean;
  leaving: boolean;
  onShown: () => void;
  /** Пролистали к другому файлу. */
  onPage: (asset: MediaLibraryItem) => void;
};

/**
 * Горизонтальный пейджер по галерее в порядке сетки: соседние страницы
 * готовятся заранее, остальные не монтируются. Галерея может дочитаться и
 * сдвинуться, пока предпросмотр открыт, — текущий файл держится по id, и
 * пейджер встаёт на его новое место.
 */
export function PreviewPager({
  gallery,
  index,
  width,
  height,
  cellSize,
  motion,
  live,
  locked,
  leaving,
  onShown,
  onPage,
}: PreviewPagerProps) {
  const listRef = useRef<FlatList<MediaLibraryItem>>(null);
  const shownIndex = useRef(index);

  useEffect(() => {
    if (shownIndex.current === index) return;

    shownIndex.current = index;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, [index]);

  const renderItem = useCallback<ListRenderItem<MediaLibraryItem>>(
    ({ item, index: at }) => (
      <PreviewPage
        asset={item}
        width={width}
        height={height}
        cellSize={cellSize}
        isActive={at === index}
        motion={motion}
        live={at === index ? live : null}
        onShown={onShown}
        leaving={leaving}
      />
    ),
    [cellSize, height, index, leaving, live, motion, onShown, width],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<MediaLibraryItem> | null | undefined, at: number) => ({
      length: width,
      offset: width * at,
      index: at,
    }),
    [width],
  );

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      const asset = gallery[next];

      if (next !== index && asset) {
        shownIndex.current = next;
        onPage(asset);
      }
    },
    [gallery, index, onPage, width],
  );

  return (
    <FlatList
      ref={listRef}
      testID="media-preview-pager"
      data={gallery}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      extraData={leaving}
      horizontal
      pagingEnabled
      scrollEnabled={!locked}
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={index}
      getItemLayout={getItemLayout}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      windowSize={3}
      onMomentumScrollEnd={onSettled}
      keyboardShouldPersistTaps="handled"
    />
  );
}
