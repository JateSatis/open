import type { ReactNode } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import type { MessageAttachment } from '@/api/chats';
import type { MosaicLayout } from '@/features/chats/lib/mosaicLayout';
import { MediaTile } from '@/features/chats/MediaTile';
import { PopCover } from '@/features/pops/PopCover';
import { useTheme } from '@/hooks/use-theme';

export type MediaAttachmentGridProps = {
  attachments: MessageAttachment[];
  /** Раскладка считается снаружи и мемоизируется там: см. `useMosaicLayout`. */
  layout: MosaicLayout;
  localPreviews?: string[];
  onPress: (index: number) => void;
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
  children,
}: MediaAttachmentGridProps) {
  const theme = useTheme();
  const hasPop = attachments.some((attachment) => attachment.popId);

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
          return (
            <View
              key={index}
              testID="pop-post-cover"
              accessibilityLabel="Pop"
              style={[
                styles.tile,
                { left: tile.x, top: tile.y, width: tile.width, height: tile.height },
              ]}
            >
              <PopCover
                posterUri={attachment.posterUrl ?? localPreviews?.[index] ?? null}
                placeholderUri={localPreviews?.[index]}
                durationMs={attachment.durationMs}
                recyclingKey={attachment.id}
              />
            </View>
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
            onPress={() => onPress(index)}
          />
        );
      })}

      {children}
    </View>
  );
}
