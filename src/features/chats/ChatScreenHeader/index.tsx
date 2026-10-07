import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { ChatHeaderTitle } from '@/features/chats/ChatHeaderTitle';
import { Sizes, Spacing } from '@/theme';

export type ChatScreenHeaderProps = {
  title: string;
  /** Аватарка слева от названия — у канала. */
  avatar?: { uri: string | null; name: string };
  subtitle?: string | null;
  onTitlePress?: () => void;
  /** Сколько отмечено; `0` — выбора нет. */
  selectedCount: number;
  onCancelSelection: () => void;
  /** Справа в обычном режиме — например, «Позвонить». */
  right?: ReactNode;
};

/**
 * Шапка переписки. В режиме выбора вместо имени — счётчик и «Отмена», а
 * стрелки «назад» нет: выход из выбора не должен уводить из чата.
 */
export function ChatScreenHeader({
  title,
  avatar,
  subtitle,
  onTitlePress,
  selectedCount,
  onCancelSelection,
  right,
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
              headerRight: right ? () => right : undefined,
              headerTitle: () =>
                avatar ? (
                  <View style={styles.withAvatar}>
                    <Avatar uri={avatar.uri} name={avatar.name} size={Sizes.headerAvatar} />
                    <ChatHeaderTitle title={title} subtitle={subtitle} onPress={onTitlePress} />
                  </View>
                ) : (
                  <ChatHeaderTitle title={title} subtitle={subtitle} onPress={onTitlePress} />
                ),
            }
      }
    />
  );
}

const styles = StyleSheet.create({
  withAvatar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
