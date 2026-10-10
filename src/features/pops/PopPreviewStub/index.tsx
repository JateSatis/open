import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type PopPreviewStubProps = { visible: boolean; onClose: () => void };

/**
 * Страница предпросмотра попа из шита медиа — пока заглушка, по решению
 * человека. Своим окном: шит медиа живёт в `Modal`, и экран из стека
 * навигатора оказался бы под ним. «Назад» возвращает в шит как был.
 */
export function PopPreviewStub({ visible, onClose }: PopPreviewStubProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        testID="pop-preview-stub"
        style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top }]}
      >
        <Pressable
          testID="pop-preview-back"
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={onClose}
          style={styles.back}
        >
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={Sizes.popBackIcon}
            tintColor={theme.text}
          />
        </Pressable>
        <View style={styles.body}>
          <Text color="textSecondary" style={styles.text}>
            Страница предпросмотра попса — доделать в будущем
          </Text>
        </View>
      </View>
    </Modal>
  );
}
