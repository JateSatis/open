import { useLocalSearchParams } from 'expo-router';

import { DialogueRequestScreen } from '@/features/chats/DialogueRequestScreen';

/** Заявка на диалог человеку, который мне не друг: чат появится вместе с её текстом. */
export default function DialogueRequestRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return <DialogueRequestScreen userId={userId} />;
}
