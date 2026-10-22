import { SymbolView } from 'expo-symbols';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type HiddenMediaKind = 'photo' | 'video' | 'voice';

export type HiddenMediaTileProps = {
  kind: HiddenMediaKind;
  /** Место и размер — те же, что у плитки самого файла. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const LABELS: Record<HiddenMediaKind, string> = {
  photo: 'Фото скрыто автором',
  video: 'Видео скрыто автором',
  voice: 'Голосовое скрыто автором',
};

/** Вид скрытого медиа по типу файла: у кружка и видео — «Видео». */
export function hiddenMediaKind(mimeType: string | null): HiddenMediaKind {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'voice';

  return 'photo';
}

export function hiddenMediaLabel(kind: HiddenMediaKind): string {
  return LABELS[kind];
}

/**
 * Медиа, которое автор скрыл от смотрящего: одноцветная плитка тех же
 * пропорций со значком и подписью. Без размытого превью — оно тоже
 * раскрывает кадр. Не нажимается: открывать нечего, файла у приложения нет.
 */
export function HiddenMediaTile({ kind, style, testID = 'hidden-media-tile' }: HiddenMediaTileProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={LABELS[kind]}
      style={[styles.tile, { backgroundColor: theme.backgroundSelected }, style]}
    >
      <SymbolView
        name={{ ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }}
        size={Sizes.menuIcon}
        tintColor={theme.textSecondary}
      />
      <Text variant="caption" color="textSecondary" numberOfLines={2} style={styles.label}>
        {LABELS[kind]}
      </Text>
    </View>
  );
}
