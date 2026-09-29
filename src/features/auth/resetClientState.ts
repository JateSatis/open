import type { QueryClient } from '@tanstack/react-query';

import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { resetPendingEdits } from '@/features/chats/messages/pendingEdits';
import { useMediaSelection } from '@/features/media/selectionStore';
import { setActiveChatId } from '@/store/activeChat';

/**
 * Всё, что приложение помнит о вошедшем человеке, — вон. Зовётся при любом
 * выходе: нажатом, принудительном (сеанс завершили с другого устройства) и
 * после удаления аккаунта. Следующий вход, в том числе под другим аккаунтом,
 * начинается с чистого листа: ни чатов, ни профиля, ни выбранных файлов
 * прежнего.
 *
 * Черновики сообщений — тоже: с ответом и пересылкой в них лежат чужие
 * сообщения.
 */
export function resetClientState(queryClient: QueryClient) {
  // cancel до clear: запрос, начатый под прежним пользователем, не должен
  // вернуться и лечь в кеш уже после очистки.
  void queryClient.cancelQueries();
  queryClient.clear();
  useMediaSelection.getState().clear();
  resetMediaSheet();
  resetOutbox();
  resetPendingEdits();
  resetComposerDrafts();
  setActiveChatId(null);
}
