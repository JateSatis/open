# Переписка и переходы к сообщениям

Слова: чат, отправка, цитата, закреп, поиск в переписке, прыжок, тред сообщений.
Сверено с `b123c6b`, 08.11.2026. Треды комментариев — [другая карточка](comments.md).

## Точки входа

<!-- prettier-ignore -->
| Сценарий | Читать по ходу данных |
| --- | --- |
| Открыть переписку | [маршрут chatId](../../src/app/%28tabs%29/chats/%5BchatId%5D.tsx) → [ChatConversation](../../src/features/chats/ChatConversation/index.tsx) → [useChatMessages](../../src/features/chats/useChatMessages.ts) |
| Список чатов | [маршрут списка](../../src/app/%28tabs%29/chats/index.tsx) → [useChats](../../src/features/chats/useChats.ts), [chats API](../../src/api/chats.ts) |
| Закреп/цитата/возврат вниз | [useJumpToMessage](../../src/features/chats/useJumpToMessage.ts), [useQuoteNavigation](../../src/features/chats/useQuoteNavigation.ts), [usePinnedMessages](../../src/features/chats/usePinnedMessages.ts) |
| Далёкая цель и подгрузка истории | [useMessageWindow](../../src/features/chats/messages/useMessageWindow.ts): `loadMessageWindow` → `listMessagesAround` в chats API; [historyCache](../../src/features/chats/messages/historyCache.ts) хранит ключи хвоста и окна |
| Отправка/повтор/выход с экрана | [MessageComposer](../../src/features/chats/MessageComposer/index.tsx) → useChatMessages → [delivery](../../src/features/chats/messages/delivery.ts), [outbox](../../src/features/chats/messages/outbox.ts) → chats API |
| Вид «Треды» в группе | [chatThreads](../../src/features/chats/chatThreads/), [ChatThreadPanel](../../src/features/chats/ChatThreadPanel/), [chatThreads API](../../src/api/chatThreads.ts) |

## Связи и границы

- `ChatConversation` собирает экран; не начинай с чтения всех его импортов и соседних экранов.
  Найди нужный обработчик/хук по таблице. Строка сообщения — [MessageRow](../../src/features/chats/MessageRow/index.tsx).
- История сервера и окно вокруг цели живут в Query-кеше, неподтверждённые исходящие — в outbox.
  `delivery` работает вне компонентов, чтобы отправка не зависела от открытого экрана.
- Дальний прыжок затрагивает загрузку окна, сохранение прежнего содержимого, позиционирование
  и анимацию `jumpGlide`; изменение одной длительности не доказывает ускорение всего перехода.
- Изменения сообщений приходят через [useChatChannel](../../src/features/chats/messages/useChatChannel.ts),
  [sync](../../src/features/chats/messages/sync.ts) и [chatTopics](../../src/api/chatTopics.ts).
  При смене ключей/страниц проверь, как обновляются и хвост, и открытое окно.
- Меняешь отправку — [права записи](../product.md#права-записи-и-обещания-приватности);
  текст/цитату/историю — [видимость сообщений](../product.md#видимость-сообщений).
  Только при изменении серверного контракта переходи к [данным](data.md).
- Медиа/голосовые используют [общую загрузку](media.md); комментарии не становятся сообщениями чата.

## Проверить изменение

Выбирай подходящее: [useJumpToMessage.test](../../src/features/chats/useJumpToMessage.test.tsx),
[useMessageWindow.test](../../src/features/chats/messages/useMessageWindow.test.tsx),
[useQuoteNavigation.test](../../src/features/chats/useQuoteNavigation.test.tsx),
[chats.test](../../src/api/chats.test.ts); для тредов — [chat_threads_access.sql](../../supabase/tests/chat_threads_access.sql).
Наличие теста не означает его прохождение; SQL требует нужной среды по backend.

На устройстве для прыжка: близкая/далёкая цель и возврат вниз, холодное/готовое окно,
правильная позиция и сохранение содержимого. Замеры — [perf](../../src/features/media/perf.ts),
`navigationPerfStart`/`navigationPerfMark`; флаги логирования выключены в обычном коде.
Jest проверяет логику, но не подтверждает плавность. Набор выбирай по фактической правке.
