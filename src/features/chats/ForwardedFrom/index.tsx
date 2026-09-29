import type { ForwardOrigin } from '@/api/chats';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type ForwardedFromProps = {
  forward: ForwardOrigin;
  isOwn: boolean;
  /** Тап — к оригиналу в исходном чате. */
  onPress?: () => void;
};

/** Строка «Переслано от …» сверху облачка пересланного сообщения. */
export function ForwardedFrom({ forward, isOwn, onPress }: ForwardedFromProps) {
  const theme = useTheme();
  const color = isOwn ? theme.primaryText : theme.primary;
  const label = forward.authorName
    ? `Переслано от ${forward.authorName}`
    : 'Переслано от удалённого аккаунта';

  return (
    <Text
      testID="forwarded-from"
      accessibilityRole={onPress ? 'button' : undefined}
      variant="small"
      numberOfLines={1}
      style={{ color }}
      onPress={onPress}
      suppressHighlighting
    >
      {label}
    </Text>
  );
}
