import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type PanelHeaderProps = {
  title: string;
  /** Окно треда: стрелка назад к основному списку. */
  onBack?: () => void;
  /** Ручка сверху — у шита, который тянут вниз; у боковой панели её нет. */
  grabber?: boolean;
};

/**
 * Верх панели: ручка и заголовок, в треде — и стрелка назад. За него шит тянут
 * вниз. Крестика нет: шит закрывают жестом, тапом по фону и «назад».
 */
export function PanelHeader({ title, onBack, grabber = true }: PanelHeaderProps) {
  const theme = useTheme();

  return (
    <View testID="comments-panel-header" style={styles.header}>
      {grabber ? <View style={[styles.handle, { backgroundColor: theme.border }]} /> : null}

      <View style={styles.titleRow}>
        <View style={styles.titleStart}>
          {onBack ? (
            <Pressable
              testID="thread-back"
              accessibilityRole="button"
              accessibilityLabel="Назад к комментариям"
              hitSlop={Spacing.two}
              onPress={onBack}
            >
              <SymbolView
                name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
                size={Spacing.four}
                tintColor={theme.text}
              />
            </Pressable>
          ) : null}
          <Text variant="smallBold">{title}</Text>
        </View>
      </View>
    </View>
  );
}
