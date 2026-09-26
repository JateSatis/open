import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type SheetOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

export type OptionsSheetProps = {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
};

/**
 * Список действий снизу экрана — как action sheet в iOS. `Alert` не подходит:
 * на Android он вмещает только три кнопки, и порядок у них платформенный.
 */
export function OptionsSheet({ visible, title, options, onClose }: OptionsSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const choose = (option: SheetOption) => {
    onClose();
    option.onPress();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID="options-sheet-backdrop"
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
        onPress={onClose}
      >
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}
        >
          <View style={[styles.group, { backgroundColor: theme.background }]}>
            {title ? (
              <Text variant="small" color="textSecondary" style={styles.title}>
                {title}
              </Text>
            ) : null}
            {options.map((option, index) => (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                onPress={() => choose(option)}
                style={({ pressed }) => [
                  styles.option,
                  (index > 0 || title) && [styles.divided, { borderTopColor: theme.border }],
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}
              >
                <Text variant="body" color={option.destructive ? 'danger' : 'primary'}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.group,
              styles.option,
              { backgroundColor: pressed ? theme.backgroundElement : theme.background },
            ]}
          >
            <Text variant="bodyBold" color="primary">
              Отмена
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
