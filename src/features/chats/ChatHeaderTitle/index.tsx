import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';

export type ChatHeaderTitleProps = {
  title: string;
  /** Статус собеседника в личном диалоге. */
  subtitle?: string | null;
  /** Тап по шапке — профиль собеседника. */
  onPress?: () => void;
};

/**
 * Шапка переписки. Пока связи нет, говорит о связи, как и остальные экраны;
 * в остальное время — имя и статус собеседника, по тапу ведёт в его профиль.
 */
export function ChatHeaderTitle({ title, subtitle, onPress }: ChatHeaderTitleProps) {
  const status = useConnectionStatus();

  if (status !== 'online' || (!subtitle && !onPress)) {
    return <ConnectionTitle title={title} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Профиль: ${title}`}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={8}
      style={styles.container}
    >
      <Text variant="bodyBold" numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}
