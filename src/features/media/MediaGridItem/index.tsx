import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { assetPreviewUri } from '@/features/media/lib/previewUri';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { countRender, perfLog } from '@/features/media/perf';
import { useSelectionIsFull, useSelectionOrder } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MediaGridItemProps = {
  asset: MediaLibraryItem;
  size: number;
  onToggle: (asset: MediaLibraryItem) => void;
};

/**
 * Нажатие на саму клетку пока ничего не делает — выбор и снятие выбора
 * идёт только через кружок в углу; превью и редактирование появятся позже.
 *
 * Клетка подписана на свой номер в выборе, а не получает его пропом: так тап
 * по кружку перерисовывает ровно одну клетку, а не всё видимое окно списка.
 * Пропы при этом остаются стабильными, и `memo` наконец работает — до этого
 * его ломала новая стрелка `onToggle` на каждый рендер грида.
 */
export const MediaGridItem = memo(function MediaGridItem({
  asset,
  size,
  onToggle,
}: MediaGridItemProps) {
  countRender('MediaGridItem');

  const theme = useTheme();
  const selectionOrder = useSelectionOrder(asset.id);
  const isFull = useSelectionIsFull();
  const [failed, setFailed] = useState(false);

  const isSelected = selectionOrder !== null;
  const disabled = isFull && !isSelected;

  return (
    <View style={{ width: size, height: size }}>
      {failed ? (
        // Файл объективно не открывается (битый, не скачан из облака,
        // незнакомый кодек). Это не «ещё грузится», и выглядеть должно иначе.
        <View
          style={[styles.thumbnail, styles.broken, { backgroundColor: theme.backgroundElement }]}
        >
          <Text variant="caption" color="textSecondary">
            ?
          </Text>
        </View>
      ) : (
        <Image
          // Источник — сам id ассета: content:// на Android, ph:// на iOS.
          // Оба expo-image открывает напрямую, у видео берёт кадр.
          source={{ uri: assetPreviewUri(asset) }}
          style={[styles.thumbnail, { backgroundColor: theme.backgroundElement }]}
          contentFit="cover"
          // Кэш и отмена загрузок за экраном — на стороне expo-image; свой
          // прогрев путей только мешал бы ему, конкурируя за тот же ресурс.
          cachePolicy="memory-disk"
          recyclingKey={asset.id}
          transition={120}
          onError={(event) => {
            perfLog('превью не открылось', { id: asset.id, error: String(event.error) });
            setFailed(true);
          }}
          accessibilityIgnoresInvertColors
        />
      )}

      {asset.kind === 'video' ? (
        <View style={[styles.videoBadge, { backgroundColor: theme.mediaScrim }]}>
          <Text variant="caption" color="textInverse">
            {asset.durationMs !== null ? formatDuration(asset.durationMs) : '▶'}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isSelected ? 'Убрать из выбранного' : 'Выбрать файл'}
        accessibilityState={{ selected: isSelected, disabled }}
        disabled={disabled}
        hitSlop={Spacing.two}
        onPress={() => onToggle(asset)}
        style={[
          styles.circle,
          {
            borderColor: theme.textInverse,
            backgroundColor: isSelected ? theme.primary : theme.mediaScrim,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        {isSelected ? (
          <Text variant="caption" color="primaryText">
            {selectionOrder}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
});
