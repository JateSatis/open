import { Image } from 'expo-image';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { styles } from './styles';

import type { MessageAttachment } from '@/api/chats';
import { isChatMediaPath } from '@/api/chatMedia';
import { Text } from '@/components/Text';
import type { MosaicTile } from '@/features/chats/lib/mosaicLayout';
import { formatDuration } from '@/features/media/lib/formatDuration';
import {
  measureView,
  useTileHidden,
  type Corners,
  type TileRect,
  type TileRegistry,
} from '@/features/media/tileRegistry';
import { useTileTap } from '@/features/media/useTileTap';
import { useMediaSource } from '@/hooks/use-media-source';
import { useTheme } from '@/hooks/use-theme';

export type MediaTileProps = {
  attachment: MessageAttachment;
  /** Номер плитки в мозаике — его получают обработчики. */
  index: number;
  tile: MosaicTile;
  /**
   * Локальная картинка того же файла — у своего только что отправленного
   * сообщения. Показывается, пока грузится удалённая: смена источника после
   * ответа сервера не даёт вспышки пустоты.
   */
  localPreview?: string;
  /** Тап: где плитка на экране — просмотр вырастает из неё. */
  onPress: (index: number, origin: TileRect | null) => void;
  /** Таблица плиток облачка: просмотр уходит в плитку файла, на котором закрыли. */
  tiles?: TileRegistry;
  /** Скругление углов плитки облачком. */
  corners?: Corners;
  /**
   * Палец задержался на плитке — просмотр можно готовить из неё; ушёл без
   * тапа — не нужно. См. `useTileTap`.
   */
  onArm?: (index: number, origin: TileRect | null) => void;
  onDisarm?: () => void;
};

function isVideo(attachment: MessageAttachment): boolean {
  return attachment.mimeType?.startsWith('video/') ?? false;
}

/**
 * Картинка плитки. У видео — его постер: сам mp4 по ссылке картинкой не
 * открыть. У видео, ещё не дошедшего до сервера, `url` — id файла в галерее,
 * и кадр из него `expo-image` достаёт сам.
 */
export function tileImageUri(attachment: MessageAttachment): string | null {
  if (!isVideo(attachment)) return attachment.url;
  if (attachment.posterUrl) return attachment.posterUrl;

  // Загруженное видео — путь в бакете или адрес попа: картинкой его не открыть.
  return attachment.url.startsWith('http') || isChatMediaPath(attachment.url) ? null : attachment.url;
}

/**
 * Одна плитка мозаики. Размер известен из метаданных ещё до загрузки
 * картинки, поэтому до неё плитка — фон-заглушка того же размера, и строка
 * списка не прыгает. Пока её медиа открыто в просмотре, плитка пуста: медиа
 * летает поверх, и двух одинаковых картинок не видно.
 */
export function MediaTile({
  attachment,
  index,
  tile,
  localPreview,
  onPress,
  tiles,
  corners,
  onArm,
  onDisarm,
}: MediaTileProps) {
  const theme = useTheme();
  const video = isVideo(attachment);
  // Путь в закрытом бакете — по подписанной ссылке, с кешем по пути.
  const source = useMediaSource(tileImageUri(attachment));
  const uri = source?.uri ?? null;
  const hidden = useTileHidden(tiles, attachment.id);
  const ref = useRef<View>(null);

  useEffect(() => {
    const view = ref.current;

    tiles?.register(attachment.id, view, corners);

    return () => tiles?.unregister(attachment.id, view);
  }, [attachment.id, corners, tiles]);

  const measure = useCallback(
    () => measureView(ref.current).then((rect) => (rect && corners ? { ...rect, corners } : rect)),
    [corners],
  );
  const tapped = useCallback((origin: TileRect | null) => onPress(index, origin), [index, onPress]);
  const armed = useCallback((origin: TileRect | null) => onArm?.(index, origin), [index, onArm]);
  const { gesture: tap, open } = useTileTap({
    measure,
    onTap: tapped,
    onArm: onArm ? armed : undefined,
    onDisarm,
    testID: `media-tile-tap-${index}`,
  });

  return (
    <GestureDetector gesture={tap}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={video ? 'Открыть видео' : 'Открыть фото'}
        onPress={open}
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
            testID="media-tile-image"
            source={source}
            placeholder={localPreview && localPreview !== uri ? { uri: localPreview } : undefined}
            placeholderContentFit="cover"
            style={[styles.image, hidden && styles.hidden]}
            contentFit="cover"
            recyclingKey={attachment.id}
            accessibilityIgnoresInvertColors
          />
        ) : null}

        {video && !hidden ? (
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
    </GestureDetector>
  );
}
