import { Image } from 'expo-image';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import { useTheme } from '@/hooks/use-theme';

export type PopCoverProps = {
  /** Постер попа — удалённый или ещё локальный кадр. Нет — тёмная заглушка. */
  posterUri: string | null;
  durationMs?: number | null;
  /** Метка «Pop» в углу: в посте и над полем ввода — да, в сетке канала — лишняя. */
  showLabel?: boolean;
  /** Подпись для `recyclingKey`: списки переиспользуют вью. */
  recyclingKey?: string;
};

/**
 * Обложка попа во весь родитель: постер, метка «Pop» и длительность. Размер и
 * пропорции задаёт родитель — сетка, облачко или вложение над полем ввода.
 */
export function PopCover({ posterUri, durationMs, showLabel = true, recyclingKey }: PopCoverProps) {
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
