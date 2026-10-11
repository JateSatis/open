import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type PopCoverProps = {
  /** Постер попа — удалённый или ещё локальный кадр. Нет — тёмная заглушка. */
  posterUri: string | null;
  durationMs?: number | null;
  /** Метка «Pop» в углу: в посте и над полем ввода — да, в сетке канала — лишняя. */
  showLabel?: boolean;
  /** Подпись для `recyclingKey`: списки переиспользуют вью. */
  recyclingKey?: string;
  /** Локальный кадр того же попа: держится, пока грузится удалённый постер. */
  placeholderUri?: string | null;
  /** Просмотры внизу слева, как в профиле TikTok. `null` — не показывать. */
  viewsCount?: number | null;
};

/**
 * Обложка попа во весь родитель: постер, метка «Pop» и длительность. Размер и
 * пропорции задаёт родитель — сетка, облачко или вложение над полем ввода.
 */
export function PopCover({
  posterUri,
  durationMs,
  showLabel = true,
  recyclingKey,
  placeholderUri,
  viewsCount = null,
}: PopCoverProps) {
  const theme = useTheme();

  return (
    <View
      testID="pop-cover"
      style={[styles.fill, { backgroundColor: theme.viewerBackground }]}
      pointerEvents="none"
    >
      {posterUri ? (
        <Image
          source={{ uri: posterUri }}
          placeholder={
            placeholderUri && placeholderUri !== posterUri ? { uri: placeholderUri } : undefined
          }
          placeholderContentFit="cover"
          style={styles.fill}
          contentFit="cover"
          recyclingKey={recyclingKey}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      {showLabel ? (
        <View style={[styles.badge, styles.label, { backgroundColor: theme.mediaScrim }]}>
          <Text variant="caption" color="textOnMedia">
            Pop
          </Text>
        </View>
      ) : null}

      {viewsCount !== null ? (
        <View
          testID="pop-tile-views"
          accessible
          accessibilityLabel={`Просмотры: ${viewsCount}`}
          style={[styles.views, { shadowColor: theme.shadow }]}
        >
          <SymbolView
            name={{ ios: 'play', android: 'play_arrow', web: 'play_arrow' }}
            size={Sizes.popTileViewsIcon}
            tintColor={theme.textOnMedia}
          />
          <Text
            variant="captionBold"
            color="textOnMedia"
            style={[styles.viewsText, { textShadowColor: theme.shadow }]}
          >
            {formatViewsCount(viewsCount)}
          </Text>
        </View>
      ) : null}

      {durationMs ? (
        <View style={[styles.badge, styles.duration, { backgroundColor: theme.mediaScrim }]}>
          <Text variant="caption" color="textOnMedia">
            {formatDuration(durationMs)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
