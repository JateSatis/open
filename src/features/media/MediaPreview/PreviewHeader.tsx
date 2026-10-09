import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { SLOT_BLOCKED, SLOT_FREE, useSelectionSlot } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Spacing } from '@/theme';

export type PreviewHeaderProps = {
  title: string;
  assetId: string;
  style: AnimatedStyle<ViewStyle>;
  onBack: () => void;
  onToggle: () => void;
};

/**
 * Шапка предпросмотра: «назад», имя чата и кружок выбора текущего файла с
 * его номером в отправке. Номер берётся из того же стора, что у клеток
 * сетки, — и пересчитывается вместе с ними.
 */
export function PreviewHeader({ title, assetId, style, onBack, onToggle }: PreviewHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slot = useSelectionSlot(assetId);
  const isSelected = slot > SLOT_FREE;

  return (
    <Animated.View
      style={[
        styles.header,
        { paddingTop: insets.top + Spacing.two, backgroundColor: theme.mediaScrim },
        style,
      ]}
    >
      <Pressable
        testID="media-preview-back"
        accessibilityRole="button"
        accessibilityLabel="Назад к галерее"
        hitSlop={Spacing.two}
        onPress={onBack}
        style={styles.headerButton}
      >
        <SymbolView
          name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          size={Spacing.four}
          tintColor={theme.textOnMedia}
        />
      </Pressable>

      <Text variant="bodyBold" color="textOnMedia" numberOfLines={1} style={styles.headerTitle}>
        {title}
      </Text>

      <View style={styles.headerButton}>
        <Pressable
          testID="media-preview-select"
          accessibilityRole="button"
          accessibilityLabel={isSelected ? 'Убрать из выбранного' : 'Выбрать файл'}
          accessibilityState={{ selected: isSelected }}
          hitSlop={Spacing.two}
          onPress={onToggle}
          style={[
            styles.circle,
            {
              borderColor: theme.textOnMedia,
              backgroundColor: isSelected ? theme.primary : theme.mediaScrim,
              opacity: slot === SLOT_BLOCKED ? Opacity.unavailable : 1,
            },
          ]}
        >
          {isSelected ? (
            <Text variant="smallBold" color="primaryText">
              {slot}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </Animated.View>
  );
}
