import { SymbolView } from 'expo-symbols';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { hiddenMediaLabel } from '@/features/chats/HiddenMediaTile';
import { voiceDurationLabel } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, type ThemeColor } from '@/theme';

export type HiddenVoiceRowProps = {
  durationMs: number | null;
  /** Цвет подписи — от облачка: своё на синем, чужое на сером. */
  color?: ThemeColor;
  style?: StyleProp<ViewStyle>;
};

/**
 * Голосовое, которое автор скрыл: длительность есть, волны и проигрывания
 * нет — волна строится из самого звука, а файла у приложения нет.
 */
export function HiddenVoiceRow({ durationMs, color = 'textSecondary', style }: HiddenVoiceRowProps) {
  const theme = useTheme();
  const label = hiddenMediaLabel('voice');

  return (
    <View
      testID="hidden-voice"
      accessible
      accessibilityLabel={`${label}, ${voiceDurationLabel(durationMs ?? 0)}`}
      style={[styles.row, style]}
    >
      <SymbolView
        name={{ ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }}
        size={Sizes.menuIcon}
        tintColor={theme[color]}
      />
      <Text variant="small" color={color} style={styles.label}>
        {label}
      </Text>
      <Text variant="caption" color={color}>
        {voiceDurationLabel(durationMs ?? 0)}
      </Text>
    </View>
  );
}
