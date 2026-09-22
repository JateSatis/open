import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import type { MessageAttachment } from '@/api/chats';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { computeMosaicLayout } from '@/features/chats/lib/mosaicLayout';
import { useTheme } from '@/hooks/use-theme';

export type MediaAttachmentGridProps = {
  attachments: MessageAttachment[];
  /** Ширина, которую мозаика обязана заполнить целиком — считается по фактическому облачку. */
  containerWidth: number;
  onPress: (index: number) => void;
};

function isVideo(attachment: MessageAttachment): boolean {
  return attachment.mimeType?.startsWith('video/') ?? false;
}

/**
 * Мозаика вложений одного сообщения — фото и видео вперемешку, каждое в
 * своих реальных пропорциях, вместе заполняющие ровный прямоугольник.
 * Раскладку считает `computeMosaicLayout`, этот компонент только рисует
 * результат и открывает просмотр по тапу.
 */
export function MediaAttachmentGrid({ attachments, containerWidth, onPress }: MediaAttachmentGridProps) {
  const theme = useTheme();

  const tiles = computeMosaicLayout(
    attachments.map((attachment) => ({
      width: attachment.width ?? 1,
      height: attachment.height ?? 1,
    })),
    containerWidth,
  );

  const totalHeight = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.height), 0);

  return (
    <View style={[styles.container, { width: containerWidth, height: totalHeight }]}>
      {attachments.map((attachment, index) => {
        const tile = tiles[index];

        if (!tile) return null;

        return (
          <Pressable
            key={attachment.id}
            accessibilityRole="button"
            accessibilityLabel={isVideo(attachment) ? 'Открыть видео' : 'Открыть фото'}
            onPress={() => onPress(index)}
            style={[styles.tile, { left: tile.x, top: tile.y, width: tile.width, height: tile.height }]}
          >
            <Image
              source={{ uri: attachment.url }}
              style={styles.image}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />

            {isVideo(attachment) ? (
              <View style={[styles.videoBadge, { backgroundColor: theme.mediaScrim }]}>
                <Text variant="caption" color="textInverse">
                  {attachment.durationMs !== null ? formatDuration(attachment.durationMs) : '▶'}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
