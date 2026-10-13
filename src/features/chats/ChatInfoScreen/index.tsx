import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { InfoBarButton, useSlideBack } from '@/components/InfoPage';
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
  const { chat, failed } = useChat(chatId);

  if (chat) return <ChatInfoPage chat={chat} />;

  return <ChatInfoPlaceholder chatId={chatId} failed={failed} />;
}

function ChatInfoPlaceholder({ chatId, failed }: { chatId: string; failed: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { offset, close } = useSlideBack();
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
