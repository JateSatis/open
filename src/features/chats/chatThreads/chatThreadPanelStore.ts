import { create } from 'zustand';

/** Открытая шторка треда: чей тред и где. */
export type OpenChatThread = {
  chatId: string;
  rootId: string;
  /** Сообщение, к которому прокрутить шторку при открытии (мой ответ из всплывашки). */
  focusMessageId?: string;
};

type State = { open: OpenChatThread | null };

/**
 * Шторка треда одна на приложение, как панель комментариев: открывают её
 * плашка и всплывашка «Ответ ушёл в тред», закрывает она сама.
 */
export const useChatThreadPanelStore = create<State>(() => ({ open: null }));

export function openChatThread(target: OpenChatThread) {
  useChatThreadPanelStore.setState({ open: target });
}

export function closeChatThread() {
  useChatThreadPanelStore.setState({ open: null });
}

export function openedChatThread(): OpenChatThread | null {
  return useChatThreadPanelStore.getState().open;
}
