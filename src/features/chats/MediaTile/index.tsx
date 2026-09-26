import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { MessageAttachment } from '@/api/chats';
import { Text } from '@/components/Text';
import type { MosaicTile } from '@/features/chats/lib/mosaicLayout';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { useTheme } from '@/hooks/use-theme';

export type MediaTileProps = {
  attachment: MessageAttachment;
  tile: MosaicTile;
  /**
   * Локальная картинка того же файла — у своего только что отправленного
   * сообщения. Показывается, пока грузится удалённая: смена источника после
   * ответа сервера не даёт вспышки пустоты.
   */
  localPreview?: string;
  onPress: () => void;
};

function isVideo(attachment: MessageAttachment): boolean {
  return attachment.mimeType?.startsWith('video/') ?? false;
}

/**
 * Картинка плитки. У видео — его постер: сам mp4 по ссылке картинкой не
 * открыть. У видео, ещё не дошедшего до сервера, `url` — id файла в галерее,
 * и кадр из него `expo-image` достаёт сам.
 */
function imageUri(attachment: MessageAttachment): string | null {
  if (!isVideo(attachment)) return attachment.url;
  if (attachment.posterUrl) return attachment.posterUrl;

  return attachment.url.startsWith('http') ? null : attachment.url;
}

/**
 * Одна плитка мозаики. Размер известен из метаданных ещё до загрузки
 * картинки, поэтому до неё плитка — фон-заглушка того же размера, и строка
 * списка не прыгает.
 */
export function MediaTile({ attachment, tile, localPreview, onPress }: MediaTileProps) {
  const theme = useTheme();
  const video = isVideo(attachment);
  const uri = imageUri(attachment);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={video ? 'Открыть видео' : 'Открыть фото'}
      onPress={onPress}
      style={[
        styles.tile,
        {
          left: tile.x,
          top: tile.y,
          width: tile.width,
          height: tile.height,
          backgroundColor: theme.backgroundSelected,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          placeholder={localPreview && localPreview !== uri ? { uri: localPreview } : undefined}
          placeholderContentFit="cover"
          style={styles.image}
          contentFit="cover"
          recyclingKey={attachment.id}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      {video ? (
        <>
          <View style={styles.center} pointerEvents="none">
            <View style={[styles.play, { backgroundColor: theme.mediaScrim }]}>
              <Text variant="body" color="textOnMedia" style={styles.playGlyph}>
                ▶
              </Text>
            </View>
          </View>

          {attachment.durationMs !== null ? (
            <View
              style={[styles.duration, { backgroundColor: theme.mediaScrim }]}
              pointerEvents="none"
            >
              <Text variant="caption" color="textOnMedia">
                {formatDuration(attachment.durationMs)}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}
