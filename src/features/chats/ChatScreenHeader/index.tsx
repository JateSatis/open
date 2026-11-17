import { useRouter } from '@/navigation';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AvatarPair, type AvatarPairPerson } from '@/components/AvatarPair';
import { PageBar } from '@/components/PageBar';
import { SlidePageHeader, useSlidePage } from '@/components/SlidePage';
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
 *
 * Своя, а не нативная шапка стека: экран переписки — страница, которая
 * уезжает за пальцем (`SlidePage`), и шапка едет вместе с ней. Встаёт сверху
 * страницы — у канала над разделами «Посты / Попсы».
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
  const router = useRouter();
  const page = useSlidePage();
  const goBack = page ? page.close : router.back;

  // Поле поиска рисует сама переписка на месте шапки.
  if (searching) return <SlidePageHeader>{null}</SlidePageHeader>;

  if (selectedCount > 0) {
    return (
      <SlidePageHeader>
        <PageBar
          testID="chat-header"
          right={
            <Pressable accessibilityRole="button" onPress={onCancelSelection} hitSlop={Spacing.two}>
              <Text color="primary">Отмена</Text>
            </Pressable>
          }
        >
          <ChatHeaderTitle title={`Выбрано: ${selectedCount}`} />
        </PageBar>
      </SlidePageHeader>
    );
  }

  const titleBlock = (
    <ChatHeaderTitle
      title={title}
      subtitle={subtitle}
      onPress={onTitlePress}
      pressLabel={titlePressLabel}
    />
  );

  return (
    <SlidePageHeader>
      <PageBar testID="chat-header" onBack={goBack} right={right}>
        {avatar ? (
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
            <View style={styles.title}>{titleBlock}</View>
          </View>
        ) : (
          titleBlock
        )}
      </PageBar>
    </SlidePageHeader>
  );
}

const styles = StyleSheet.create({
  withAvatar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
});
