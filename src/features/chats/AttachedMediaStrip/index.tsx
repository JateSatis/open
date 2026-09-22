import { Image } from 'expo-image';
import { FlatList, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import type { LibraryAsset } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';

export type AttachedMediaStripProps = {
  media: LibraryAsset[];
  onRemove: (id: string) => void;
};

/**
 * Полоска выбранных файлов над полем ввода — видна и под чатом, и внутри
 * шита выбора медиа, потому что у обоих composers общий черновик. Тап по
 * миниатюре снимает выбор — симметрично кружку в гриде.
 */
export function AttachedMediaStrip({ media, onRemove }: AttachedMediaStripProps) {
  const theme = useTheme();

  if (media.length === 0) return null;

  return (
    <FlatList
      testID="attached-media-strip"
      data={media}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(asset) => asset.id}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Убрать файл"
          onPress={() => onRemove(item.id)}
          style={styles.thumbnailWrapper}
        >
          <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" />

          {item.kind === 'video' ? (
            <View style={[styles.videoBadge, { backgroundColor: theme.mediaScrim }]}>
              <Text variant="caption" color="textInverse">
                ▶
              </Text>
            </View>
          ) : null}

          <View style={[styles.removeBadge, { backgroundColor: theme.mediaScrim }]}>
            <Text variant="caption" color="textInverse">
              ✕
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}
