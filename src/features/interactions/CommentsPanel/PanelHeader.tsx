import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type PanelHeaderProps = {
  title: string;
  /** Шит тянут за шапку: вверх — развернуть, вниз — свернуть или закрыть. */
  dragGesture: GestureType;
  onClose: () => void;
};

/** Верх панели: ручка, «N комментариев» и крестик. За него панель и тянут вниз. */
export function PanelHeader({ title, dragGesture, onClose }: PanelHeaderProps) {
  const theme = useTheme();

  return (
    <GestureDetector gesture={dragGesture}>
      <View testID="comments-panel-header" style={styles.header}>
        <View style={[styles.handle, { backgroundColor: theme.border }]} />

        <View style={styles.titleRow}>
          <Text variant="smallBold">{title}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть комментарии"
            hitSlop={Spacing.two}
            onPress={onClose}
          >
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={Spacing.four}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        </View>
      </View>
    </GestureDetector>
  );
}
