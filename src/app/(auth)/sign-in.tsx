import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';

export default function SignInScreen() {
  return (
    <Screen>
      <Text variant="title">Вход</Text>
      <Text color="textSecondary">
        Экран-заглушка. Вход через Google, Apple и другие провайдеры появится здесь.
      </Text>
    </Screen>
  );
}
