import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import {
  SLOT_BLOCKED,
  SLOT_FREE,
  useSelectionCount,
  useSelectionSlot,
} from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Spacing } from '@/theme';

export type PreviewHeaderProps = {
  title: string;
  assetId: string;
  style: AnimatedStyle<ViewStyle>;
  /** Открыт инструмент: шапка спрятана и не принимает касаний. */
  hidden: boolean;
  onBack: () => void;
  /** Нет — файл не выбирают (шит аватарки): кружка и счётчика нет. */
  onToggle?: () => void;
};

/**
 * Шапка предпросмотра: «назад», имя чата и кружок выбора текущего файла.
 * Выбранный файл — номер в отправке на акцентной заливке; невыбранный —
 * пустой кружок со счётчиком всего выбранного, чтобы при листании было
 * видно, сколько уже уходит. Числа — из того же стора, что у клеток сетки.
 * Без `onToggle` на месте кружка пусто — заголовок остаётся по центру.
 */
export function PreviewHeader({
  title,
  assetId,
  style,
  hidden,
  onBack,
  onToggle,
}: PreviewHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
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
        {onToggle ? <SelectionCircle assetId={assetId} onToggle={onToggle} /> : null}
      </View>
    </Animated.View>
  );
}

function SelectionCircle({ assetId, onToggle }: { assetId: string; onToggle: () => void }) {
  const theme = useTheme();
  const slot = useSelectionSlot(assetId);
  const count = useSelectionCount();
  const isSelected = slot > SLOT_FREE;
  const label = isSelected ? slot : count > 0 ? count : null;

  return (
    <Pressable
      testID="media-preview-select"
      accessibilityRole="button"
      accessibilityLabel={isSelected ? 'Убрать из выбранного' : 'Выбрать файл'}
      accessibilityHint={count > 0 ? `Выбрано файлов: ${count}` : undefined}
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
      {label !== null ? (
        <Text
          testID="media-preview-select-count"
          variant="smallBold"
          color={isSelected ? 'primaryText' : 'textOnMedia'}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
