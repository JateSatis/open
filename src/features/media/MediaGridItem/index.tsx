import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import type { LibraryAsset } from '@/features/media/mediaLibrary';
import { useVideoThumbnail } from '@/features/media/useVideoThumbnail';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MediaGridItemProps = {
  asset: LibraryAsset;
  size: number;
  /** Порядковый номер (с единицы), или `null`, если файл не выбран. */
  selectionOrder: number | null;
  /** Лимит уже набран, а этот файл ещё не выбран — кружок недоступен. */
  disabled: boolean;
  onToggle: () => void;
};

/**
 * Нажатие на саму клетку пока ничего не делает — выбор и снятие выбора
 * идёт только через кружок в углу; превью и редактирование появятся позже.
 */
export function MediaGridItem({ asset, size, selectionOrder, disabled, onToggle }: MediaGridItemProps) {
  const theme = useTheme();
  const videoThumbnail = useVideoThumbnail(asset.kind === 'video' ? asset.uri : '');
  const isSelected = selectionOrder !== null;
  const imageUri = asset.kind === 'video' ? videoThumbnail : asset.uri;

  return (
    <View style={{ width: size, height: size }}>
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={styles.thumbnail}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: theme.backgroundElement }]} />
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
        accessibilityState={{ selected: isSelected, disabled: disabled && !isSelected }}
        disabled={disabled && !isSelected}
        hitSlop={Spacing.two}
        onPress={onToggle}
        style={[
          styles.circle,
          {
            borderColor: theme.textInverse,
            backgroundColor: isSelected ? theme.primary : theme.mediaScrim,
            opacity: disabled && !isSelected ? 0.4 : 1,
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
}
