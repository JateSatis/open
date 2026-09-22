import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useAssetUri } from '@/features/media/useAssetUri';
import { useVideoThumbnail } from '@/features/media/useVideoThumbnail';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type MediaGridItemProps = {
  asset: MediaLibraryItem;
  size: number;
  /** Порядковый номер (с единицы), или `null`, если файл не выбран. */
  selectionOrder: number | null;
  /** Лимит уже набран, а этот файл ещё не выбран — кружок недоступен. */
  disabled: boolean;
  /** Отдаёт уже разрешённый `uri` — клетка сама знает, когда файл готов открыться. */
  onToggle: (uri: string) => void;
};

/**
 * Нажатие на саму клетку пока ничего не делает — выбор и снятие выбора
 * идёт только через кружок в углу; превью и редактирование появятся позже.
 *
 * `React.memo`: FlatList пересоздаёт клетки при каждом скролле, и без
 * memo любое изменение выбора в гриде перерисовывало бы вообще все клетки в
 * зоне видимости, а не только ту, которую тронули.
 */
export const MediaGridItem = memo(function MediaGridItem({
  asset,
  size,
  selectionOrder,
  disabled,
  onToggle,
}: MediaGridItemProps) {
  const theme = useTheme();
  const uri = useAssetUri(asset.id);
  const videoThumbnail = useVideoThumbnail(asset.kind === 'video' && uri ? uri : '');
  const isSelected = selectionOrder !== null;
  const imageUri = asset.kind === 'video' ? videoThumbnail : uri;

  const handleToggle = () => {
    // Кружок недоступен на долю секунды, пока файл резолвится — не сама
    // клетка блокируется, а лишь нечего пока передать наверх.
    if (!uri) return;

    onToggle(uri);
  };

  return (
    <View style={{ width: size, height: size }}>
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={styles.thumbnail}
          contentFit="cover"
          // Плавное появление вместо резкого попкорна по кадру — как только
          // конкретная клетка выше по скроллу успела резолвиться.
          transition={200}
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
        onPress={handleToggle}
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
});
