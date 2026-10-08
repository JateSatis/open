import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { PopCover } from '@/features/pops/PopCover';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type PopAttachmentChipProps = {
  posterUri: string | null;
  /** Нет — поп не убрать (правка поста: поп в посте не меняется). */
  onRemove?: () => void;
  /** Своей полосой над полем ввода, а не миниатюрой в ряду вложений правки. */
  standalone?: boolean;
};

/**
 * Поп как вложение над полем ввода: обложка размером с миниатюру вложения,
 * подпись «Pop» внутри и, если поп можно открепить, ✕ — в том же виде, что
 * вложения правки.
 */
export function PopAttachmentChip({ posterUri, onRemove, standalone }: PopAttachmentChipProps) {
  const theme = useTheme();

  const chip = (
    <View
      testID="pop-attachment"
      accessibilityLabel="Pop"
      style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]}
    >
      <PopCover posterUri={posterUri} showLabel={false} />
      <View style={[styles.label, { backgroundColor: theme.mediaScrim }]}>
        <Text variant="caption" color="textOnMedia">
          Pop
        </Text>
      </View>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Открепить поп"
          hitSlop={Spacing.one}
          onPress={onRemove}
          style={[styles.remove, { backgroundColor: theme.mediaScrim }]}
        >
          <Text variant="caption" color="textOnMedia">
            ✕
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return standalone ? <View style={styles.strip}>{chip}</View> : chip;
}
