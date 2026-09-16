import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';

export default function FeedScreen() {
  return (
    <Screen>
      <Text variant="title">Лента</Text>
      <Text color="textSecondary">Фрагменты чатов, посты и клипы появятся здесь.</Text>
    </Screen>
  );
}
