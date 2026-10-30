import { ChatThreadWindow } from './ChatThreadWindow';
import type { ChatThreadPanelKit } from './kit';

import { useChatThreadPanelStore } from '@/features/chats/chatThreads/chatThreadPanelStore';

export type { ChatThreadPanelKit } from './kit';

/**
 * Шторка треда этого чата, если она открыта. Окно живёт, пока тред открыт:
 * закрытие размонтирует его вместе с черновиком выбора и меню.
 */
export function ChatThreadPanel({ kit }: { kit: ChatThreadPanelKit }) {
  const open = useChatThreadPanelStore((state) => state.open);

  if (!open || open.chatId !== kit.chatId) return null;

  return <ChatThreadWindow key={open.rootId} kit={kit} open={open} />;
}
