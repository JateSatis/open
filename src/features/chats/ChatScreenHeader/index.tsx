import { Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { Text } from '@/components/Text';
import { ChatHeaderTitle } from '@/features/chats/ChatHeaderTitle';
import { Spacing } from '@/theme';

export type ChatScreenHeaderProps = {
  title: string;
  subtitle?: string | null;
  onTitlePress?: () => void;
  /** Сколько отмечено; `0` — выбора нет. */
  selectedCount: number;
  onCancelSelection: () => void;
};

/**
 * Шапка переписки. В режиме выбора вместо имени — счётчик и «Отмена», а
 * стрелки «назад» нет: выход из выбора не должен уводить из чата.
 */
export function ChatScreenHeader({
  title,
  subtitle,
  onTitlePress,
  selectedCount,
  onCancelSelection,
}: ChatScreenHeaderProps) {
  return (
    <Stack.Screen
      options={
        selectedCount > 0
          ? {
              headerBackVisible: false,
              headerTitle: () => <ChatHeaderTitle title={`Выбрано: ${selectedCount}`} />,
              headerRight: () => (
                <Pressable
                  accessibilityRole="button"
                  onPress={onCancelSelection}
                  hitSlop={Spacing.two}
                >
                  <Text color="primary">Отмена</Text>
                </Pressable>
              ),
            }
          : {
              headerBackVisible: true,
              headerRight: undefined,
              headerTitle: () => (
                <ChatHeaderTitle title={title} subtitle={subtitle} onPress={onTitlePress} />
              ),
            }
      }
    />
  );
}
