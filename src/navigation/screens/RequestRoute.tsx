import { useRouteParams } from '@/navigation';

import { DialogueRequestScreen } from '@/features/chats/DialogueRequestScreen';

/** Заявка на диалог человеку, который мне не друг: чат появится вместе с её текстом. */
export function RequestRoute() {
  const { userId } = useRouteParams<'Request'>();

  return <DialogueRequestScreen userId={userId} />;
}
