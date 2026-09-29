import type { QueryClient } from '@tanstack/react-query';

import { resetMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { useMediaSelection } from '@/features/media/selectionStore';
import { setActiveChatId } from '@/store/activeChat';

/**
 * Всё, что приложение помнит о вошедшем человеке, — вон. Зовётся при любом
 * выходе: нажатом, принудительном (сеанс завершили с другого устройства) и
 * после удаления аккаунта. Следующий вход, в том числе под другим аккаунтом,
 * начинается с чистого листа: ни чатов, ни профиля, ни выбранных файлов
 * прежнего.
 *
 * Черновики сообщений — состояние экрана чата и уходят вместе с ним.
 */
export function resetClientState(queryClient: QueryClient) {
  // cancel до clear: запрос, начатый под прежним пользователем, не должен
  // вернуться и лечь в кеш уже после очистки.
  void queryClient.cancelQueries();
  queryClient.clear();
  useMediaSelection.getState().clear();
  resetMediaSheet();
  resetOutbox();
  setActiveChatId(null);
}
