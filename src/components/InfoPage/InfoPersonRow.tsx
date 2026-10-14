import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MenuAnchor } from '@/components/AnchoredMenu';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing } from '@/theme';

export type InfoPersonRowProps = {
  name: string;
  avatarUrl: string | null;
  /** «в сети» — акцентом; null — пока не известно. */
  status: { text: string; accent?: boolean } | null;
  /** Справа мелко: «владелец». */
  badge?: string;
  onPress: () => void;
  /** Долгое нажатие — меню у строки. Нет — строка его не открывает. */
  onLongPress?: (anchor: MenuAnchor) => void;
  /** Подсвечена: у неё открыто меню. */
  highlighted?: boolean;
  testID?: string;
};

/** Строка человека: аватарка, имя, статус. Тап — его профиль. */
export function InfoPersonRow({
  name,
  avatarUrl,
  status,
  badge,
  onPress,
  onLongPress,
  highlighted = false,
  testID,
}: InfoPersonRowProps) {
  const theme = useTheme();
  const rowRef = useRef<View>(null);

  const longPress = onLongPress
    ? () =>
        rowRef.current?.measureInWindow((x, y, width, height) =>
          onLongPress({ x, y, width, height }),
        )
    : undefined;

  return (
    <Pressable
      ref={rowRef}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      onLongPress={longPress}
      style={({ pressed }) => [
        styles.person,
        (pressed || highlighted) && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Avatar uri={avatarUrl} name={name} size={InfoPageSizes.rowAvatar} />
      <View style={styles.personText}>
        <Text variant="bodyBold" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="small"
          color={status?.accent ? 'primary' : 'textSecondary'}
          numberOfLines={1}
        >
          {status?.text ?? ' '}
        </Text>
      </View>
      {badge ? (
        <Text variant="caption" color="textSecondary">
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  person: {
    height: InfoPageSizes.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  personText: {
    flex: 1,
  },
});
