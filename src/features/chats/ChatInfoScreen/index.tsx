import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { InfoBarButton, useSlideBack, type SlideBack } from '@/components/InfoPage';
import { LoadFailed } from '@/components/LoadFailed';
import { ChatInfoPage } from '@/features/chats/ChatInfoPage';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing } from '@/lib/loadState';

export type ChatInfoScreenProps = {
  chatId: string;
};

/**
 * Страница информации о чате по адресу. Из переписки чат уже лежит в кеше, и
 * страница стоит целиком в первом же кадре; без кеша — пустая страница со
 * стрелкой, пока чат грузится.
 */
export function ChatInfoScreen({ chatId }: ChatInfoScreenProps) {
  const router = useRouter();
  const { chat, failed } = useChat(chatId);
  // Одна на маршрут: заглушка и страница въезжают и уходят одним движением.
  // Под страницей ничего нет (открыли ссылкой) — уйти в саму переписку.
  const toChat = useCallback(() => router.replace(`/chats/${chatId}`), [chatId, router]);
  const slideBack = useSlideBack(toChat);

  if (chat) return <ChatInfoPage chat={chat} slideBack={slideBack} />;

  return <ChatInfoPlaceholder chatId={chatId} failed={failed} slideBack={slideBack} />;
}

function ChatInfoPlaceholder({
  chatId,
  failed,
  slideBack,
}: {
  chatId: string;
  failed: boolean;
  slideBack: SlideBack;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { offset, close } = slideBack;
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, pageStyle]}
    >
      <View style={[styles.bar, { marginTop: insets.top }]}>
        <InfoBarButton
          testID="info-back"
          icon={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          accessibilityLabel="Назад"
          onPress={close}
        />
      </View>
      <View style={styles.centered}>
        {failed ? (
          <LoadFailed
            message="Не удалось открыть чат"
            onRetry={() => reloadMissing(queryClient, [chatQueryKey(chatId)])}
          />
        ) : (
          <ActivityIndicator accessibilityLabel="Загрузка чата" />
        )}
      </View>
    </Animated.View>
  );
}
