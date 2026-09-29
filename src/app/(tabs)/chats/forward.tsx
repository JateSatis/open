import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';

import { cancelForwardPick, finishForwardPick } from '@/features/chats/composerDraftStore';
import { ForwardChatPicker } from '@/features/chats/ForwardChatPicker';
import { useTheme } from '@/hooks/use-theme';

/**
 * «Переслать» → выбор чата. Выбранный чат открывается с плашкой пересылки
 * над полем ввода; отправка — уже там, как в Telegram.
 */
export default function ForwardScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { from } = useLocalSearchParams<{ from?: string }>();

  // Ушёл без выбора — пересылать нечего.
  useEffect(() => () => cancelForwardPick(), []);

  const pick = useCallback(
    (chatId: string) => {
      if (!finishForwardPick(chatId) || chatId === from) {
        // Пересылка в тот же чат: он уже под этим экраном.
        router.back();
        return;
      }

      // replace: «назад» из целевого чата ведёт туда, откуда пересылали.
      router.replace(`/chats/${chatId}`);
    },
    [from, router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ForwardChatPicker onPick={pick} />
    </View>
  );
}
