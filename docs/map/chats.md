# Переписка и переходы к сообщениям

Слова: чат, отправка, цитата, закреп, поиск в переписке, прыжок, тред сообщений.
Обновлено 09.11.2026: реализация переходов к сообщениям удалена по решению человека. Треды комментариев — [другая карточка](comments.md).

## Точки входа

<!-- prettier-ignore -->
| Сценарий | Читать по ходу данных |
| --- | --- |
| Открыть переписку | [маршрут chatId](../../src/app/%28tabs%29/chats/%5BchatId%5D.tsx) → [ChatConversation](../../src/features/chats/ChatConversation/index.tsx) → [useChatMessages](../../src/features/chats/useChatMessages.ts) |
| Список чатов | [маршрут списка](../../src/app/%28tabs%29/chats/index.tsx) → [useChats](../../src/features/chats/useChats.ts), [chats API](../../src/api/chats.ts) |
| Закрепы и цитаты | [usePinnedMessages](../../src/features/chats/usePinnedMessages.ts), [PinnedBar](../../src/features/chats/PinnedBar/index.tsx), [useChatBubbles](../../src/features/chats/useChatBubbles.tsx): отображение без перехода к сообщению |
| Открытие и подгрузка основной истории | [useChatHistory](../../src/features/chats/messages/useChatHistory.ts) → [страницы и сверка SQLite](../../src/features/chats/messages/local/loader.ts) → [группировка](../../src/features/chats/messages/historyCache.ts). [Место чтения](../../src/features/chats/ChatConversation/useReadingPlace.tsx) сохраняется по координатам строки списка |
| Серверный участок истории (чат и посты канала) | [historyWindow API](../../src/api/historyWindow.ts): `getHistoryWindow` → `get_history_element_window` + `history_page_parents` / `history_page_forwards`; [контракт](../backend.md#участок-истории). Основная история использует элементы и составной курсор; треды сохраняют старый API |
| Граница прочитанного | [Выбор начального участка](../../src/features/chats/ChatConversation/useHistoryOpening.ts) → [измерение показанных строк](../../src/features/chats/ChatConversation/useReadingPlace.tsx) → [очередь и доставка](../../src/features/chats/useMarkChatRead.ts) → [серверные отметки](../../supabase/migrations/20261116100000_history_read_frontier.sql). Сигнал `history_read` приходит только в личный канал читателя. |
| Отправка/повтор/выход с экрана | [MessageComposer](../../src/features/chats/MessageComposer/index.tsx) → useChatMessages → [delivery](../../src/features/chats/messages/delivery.ts), [outbox](../../src/features/chats/messages/outbox.ts) → chats API |
| Вид «Треды» в группе | [chatThreads](../../src/features/chats/chatThreads/), [ChatThreadPanel](../../src/features/chats/ChatThreadPanel/), [chatThreads API](../../src/api/chatThreads.ts) |

## Связи и границы

- `ChatConversation` собирает экран; не начинай с чтения всех его импортов и соседних экранов.
  Найди нужный обработчик/хук по таблице. Строка сообщения — [MessageRow](../../src/features/chats/MessageRow/index.tsx).
- История сервера живёт в Query-кеше, неподтверждённые исходящие — в outbox.
  `delivery` работает вне компонентов, чтобы отправка не зависела от открытого экрана.
- Переходы к сообщениям внутри чата, канала, треда и между чатами удалены. Цитаты,
  поиск и сохранённые копии остаются читаемыми, но не открывают исходное сообщение.
  Удалены адресные параметры, подсветка цели, анимация прыжка, возврат вниз и предзагрузка окон.
  Переходы к попсам и их комментариям из сообщений и сохранённых также удалены.
  В «Сохранённых» удалены переходы по цитатам, закрепам и результатам поиска; фильтр тегов
  просто обновляет список. Поиск показывает число совпадений и список без переходов.
  Обычное открытие чата, ручная прокрутка, отправка и просмотр попсов из сетки канала сохранены.
  Переключение вида «Треды» открывает список с начала без восстановления позиции.
- Изменения сообщений приходят через [useChatChannel](../../src/features/chats/messages/useChatChannel.ts),
  [sync](../../src/features/chats/messages/sync.ts) и [chatTopics](../../src/api/chatTopics.ts).
  При смене ключей/страниц проверь обновление обычной истории, вида «Треды» и открытых тредов.
- Меняешь отправку — [права записи](../product.md#права-записи-и-обещания-приватности);
  текст/цитату/историю — [видимость сообщений](../product.md#видимость-сообщений).
  Только при изменении серверного контракта переходи к [данным](data.md).
- Медиа/голосовые используют [общую загрузку](media.md); комментарии не становятся сообщениями чата.

## Проверить изменение

Выбирай подходящее: [цитаты и отправка](../../src/app/%28tabs%29/chats/%5BchatId%5D.reply.test.tsx),
[пересланные комментарии](../../src/app/%28tabs%29/chats/%5BchatId%5D.commentForward.test.tsx),
[chats.test](../../src/api/chats.test.ts); для тредов — [chat_threads_access.sql](../../supabase/tests/chat_threads_access.sql).
Наличие теста не означает его прохождение; SQL требует нужной среды по backend.

На устройстве: цитата и закреп не перемещают переписку; старые адресные параметры не
загружают цель; ручная прокрутка, подгрузка и отправка работают. Проверяй также обычное
открытие чатов и раздела «Посты». Jest не подтверждает визуальную целостность экрана.
