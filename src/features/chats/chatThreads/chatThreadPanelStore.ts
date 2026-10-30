import { create } from 'zustand';

/** Открытая шторка треда: чей тред и где. */
export type OpenChatThread = {
  chatId: string;
  rootId: string;
  /**
   * К чему прокрутить шторку при открытии: к сообщению или в конец треда
   * (`'end'` — мой ответ из всплывашки «Ответ ушёл в тред»).
   */
  focusMessageId?: string | 'end';
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
