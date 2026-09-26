import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { Text } from '@/components/Text';

/** Кнопка в шапке «Чатов»: выбор людей и создание чата. */
export function NewChatButton() {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Новый чат"
      hitSlop={12}
      onPress={() => router.push('/chats/new')}
    >
      <Text variant="bodyBold" color="primary">
        Новый чат
      </Text>
    </Pressable>
  );
}
