import { useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { MessageAttachment } from '@/api/chats';
import { HiddenMediaTile, hiddenMediaKind } from '@/features/chats/HiddenMediaTile';
import type { MosaicLayout } from '@/features/chats/lib/mosaicLayout';
import { MediaTile } from '@/features/chats/MediaTile';
import { Text } from '@/components/Text';
import { PopCover } from '@/features/pops/PopCover';
import type { Corners, TileRect, TileRegistry } from '@/features/media/tileRegistry';
import { useTheme } from '@/hooks/use-theme';
import { Radii } from '@/theme';

export type MediaAttachmentGridProps = {
  attachments: MessageAttachment[];
  /** Раскладка считается снаружи и мемоизируется там: см. `useMosaicLayout`. */
  layout: MosaicLayout;
  localPreviews?: string[];
  /** Тап по плитке: её номер и место на экране (у попа места нет). */
  onPress: (index: number, origin: TileRect | null) => void;
  /** Таблица плиток облачка — в неё пишутся плитки фото и видео. */
  tiles?: TileRegistry;
  /**
   * Мозаика у верхнего и нижнего края облачка — её углы скруглены вместе с
   * ним. Плитке это нужно, чтобы медиа вылетало из неё с теми же углами.
   */
  edges?: { top: boolean; bottom: boolean };
  /** Палец лёг на плитку — окно просмотра можно готовить; ушёл без тапа — не нужно. */
  onArm?: (index: number, origin: TileRect | null) => void;
  onDisarm?: () => void;
  /** Слой поверх мозаики — плашка времени у медиа без подписи. */
  children?: ReactNode;
};

/**
 * Мозаика вложений одного сообщения. Раскладку считает `computeMosaicLayout`,
 * здесь она только рисуется. Скругление даёт облачко вокруг, у самой мозаики
 * углы прямые.
 */
export function MediaAttachmentGrid({
  attachments,
  layout,
  localPreviews,
  onPress,
  tiles,
  edges,
  onArm,
  onDisarm,
  children,
}: MediaAttachmentGridProps) {
  const theme = useTheme();
  const hasPop = attachments.some((attachment) => attachment.popId);
  // Новые объекты углов на каждую перерисовку облачка перерегистрировали бы
  // плитки и пересобирали их жест.
  const corners = useMemo(
    () => layout.tiles.map((tile) => tileCorners(tile, layout, edges)),
    [edges, layout],
  );

  return (
    <View
      testID="media-mosaic"
      style={[
        styles.container,
        { width: layout.width, height: layout.height },
        // Вертикальная обложка попа — на тёмной полосе во всю ширину, как кадр в плеере.
        hasPop && { backgroundColor: theme.viewerBackground },
      ]}
    >
      {attachments.map((attachment, index) => {
        const tile = layout.tiles[index];

        if (!tile) return null;

        if (attachment.popId) {
          const place = { left: tile.x, top: tile.y, width: tile.width, height: tile.height };

          // Поп удалён — пост остаётся, на месте обложки плашка; открывать нечего.
          if (attachment.popDeleted) {
            return (
              <View
                key={index}
                testID="pop-post-deleted"
                style={[
                  styles.tile,
                  styles.popDeleted,
                  place,
                  { backgroundColor: theme.viewerBackground },
                ]}
              >
                <Text variant="small" color="textOnMediaSecondary">
                  Поп удалён
                </Text>
              </View>
            );
          }

          return (
            <Pressable
              key={index}
              testID="pop-post-cover"
              accessibilityLabel="Pop"
              disabled
              style={[styles.tile, place]}
            >
              <PopCover
                posterUri={attachment.posterUrl ?? localPreviews?.[index] ?? null}
                placeholderUri={localPreviews?.[index]}
                durationMs={attachment.durationMs}
                recyclingKey={attachment.id}
              />
            </Pressable>
          );
        }

        // Автор скрыл файл от меня — плитка с подписью на том же месте,
        // сетка альбома не меняется.
        if (attachment.hidden) {
          return (
            <HiddenMediaTile
              key={index}
              kind={hiddenMediaKind(attachment.mimeType)}
              style={[
                styles.tile,
                { left: tile.x, top: tile.y, width: tile.width, height: tile.height },
              ]}
            />
          );
        }

        return (
          <MediaTile
            // По позиции, а не по id: у оптимистичного сообщения id вложений
            // локальные, и смена на серверные не должна пересоздавать плитки.
            key={index}
            attachment={attachment}
            tile={tile}
            localPreview={localPreviews?.[index]}
            index={index}
            onPress={onPress}
            tiles={tiles}
            corners={corners[index]}
            onArm={onArm}
            onDisarm={onDisarm}
          />
        );
      })}

      {children}
    </View>
  );
}

/** Полпикселя: края плиток считаются в дробных dp. */
const EDGE_EPSILON = 0.5;

/** Какие углы плитки совпадают со скруглёнными углами облачка. */
function tileCorners(
  tile: MosaicLayout['tiles'][number],
  layout: MosaicLayout,
  edges: { top: boolean; bottom: boolean } | undefined,
): Corners | undefined {
  if (!edges) return undefined;

  const left = tile.x < EDGE_EPSILON;
  const right = tile.x + tile.width > layout.width - EDGE_EPSILON;
  const top = edges.top && tile.y < EDGE_EPSILON;
  const bottom = edges.bottom && tile.y + tile.height > layout.height - EDGE_EPSILON;

  return {
    topLeft: top && left ? Radii.lg : 0,
    topRight: top && right ? Radii.lg : 0,
    bottomLeft: bottom && left ? Radii.lg : 0,
    bottomRight: bottom && right ? Radii.lg : 0,
  };
}
