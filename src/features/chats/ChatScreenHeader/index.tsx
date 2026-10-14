import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AvatarPair, type AvatarPairPerson } from '@/components/AvatarPair';
import { Text } from '@/components/Text';
import { ChatHeaderTitle } from '@/features/chats/ChatHeaderTitle';
import { Sizes, Spacing } from '@/theme';

export type ChatScreenHeaderProps = {
  title: string;
  /**
   * Аватарка слева от названия: у канала — одна, у чужого личного диалога —
   * две внахлёст.
   */
  avatar?: AvatarPairPerson | [AvatarPairPerson, AvatarPairPerson];
  subtitle?: string | null;
  onTitlePress?: () => void;
  /** Куда ведёт тап по шапке — для озвучки: «Профиль», «О чате». */
  titlePressLabel?: string;
  /** Сколько отмечено; `0` — выбора нет. */
  selectedCount: number;
  onCancelSelection: () => void;
  /** Справа в обычном режиме — например, «Позвонить». */
  right?: ReactNode;
  /** Поиск по чату: шапки нет, на её месте поле переписки. */
  searching?: boolean;
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
  titlePressLabel,
  selectedCount,
  onCancelSelection,
  right,
  searching = false,
}: ChatScreenHeaderProps) {
  return (
    <Stack.Screen
      options={
        searching
          ? // Поле поиска рисует сама переписка: в нативной шапке Android
            // не отдаёт полю фокус, и клавиатура не открывалась бы.
            { headerShown: false }
          : selectedCount > 0
            ? {
                headerShown: true,
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
                headerShown: true,
                headerBackVisible: true,
                headerRight: right ? () => right : undefined,
                headerTitle: () =>
                  avatar ? (
                    <View style={styles.withAvatar}>
                      {Array.isArray(avatar) ? (
                        <AvatarPair
                          testID="chat-header-avatar-pair"
                          first={avatar[0]}
                          second={avatar[1]}
                          size={Sizes.headerAvatar}
                        />
                      ) : (
                        // Аватарка — та же шапка: тап по ней ведёт туда же,
                        // озвучивает же её подпись рядом.
                        <Pressable
                          testID="chat-header-avatar"
                          accessible={false}
                          disabled={!onTitlePress}
                          onPress={onTitlePress}
                          hitSlop={Spacing.one}
                        >
                          <Avatar uri={avatar.uri} name={avatar.name} size={Sizes.headerAvatar} />
                        </Pressable>
                      )}
                      <ChatHeaderTitle
                        title={title}
                        subtitle={subtitle}
                        onPress={onTitlePress}
                        pressLabel={titlePressLabel}
                      />
                    </View>
                  ) : (
                    <ChatHeaderTitle
                      title={title}
                      subtitle={subtitle}
                      onPress={onTitlePress}
                      pressLabel={titlePressLabel}
                    />
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
