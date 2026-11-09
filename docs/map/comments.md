# Комментарии, реакции и фрагменты

Слова: шит комментариев, боковая панель, ответ, тред комментария, реакция, выделение текста.
Сверено с `b123c6b`, 08.11.2026. Ответ участника в переписке ищи в [чатах](chats.md).

## Точки входа

<!-- prettier-ignore -->
| Сценарий | Читать по ходу данных |
| --- | --- |
| Открыть/закрыть шит или панель | [CommentsPanel](../../src/features/interactions/CommentsPanel/index.tsx), [commentsPanelStore](../../src/features/interactions/comments/commentsPanelStore.ts), [PanelContent](../../src/features/interactions/CommentsPanel/PanelContent.tsx) |
| Корневые комментарии и ответы | [usePanelComments](../../src/features/interactions/CommentsPanel/usePanelComments.ts) → [useComments](../../src/features/interactions/comments/useComments.ts), [useCommentThread](../../src/features/interactions/comments/useCommentThread.ts) → [comments API](../../src/api/comments.ts) |
| Отправить и получить обновление | [commentDelivery](../../src/features/interactions/comments/commentDelivery.ts), [commentSync](../../src/features/interactions/comments/commentSync.ts), [commentTopics](../../src/api/commentTopics.ts) |
| Реакции | [MessageReactions](../../src/features/interactions/MessageReactions/), [ReactionPicker](../../src/features/interactions/ReactionPicker/), [reactions API](../../src/api/reactions.ts) |
| Выделение и кластеры фрагментов | [fragments API](../../src/api/fragments.ts), [fragmentClusters API](../../src/api/fragmentClusters.ts), [fragment-clusters function](../../supabase/functions/fragment-clusters/handler.ts); UI-кандидаты ищи по `fragment`/`cluster` в chats и interactions |

## Связи и границы

- UI-цель и открытый тред хранятся в `commentsPanelStore`, данные корней/ответов — в Query-кеше.
  Переходы по цитатам внутри шита и боковой панели удалены: цитаты не нажимаются.
- Комментарии к сообщению и попу используют общую инфраструктуру, но разные цели/запросы.
  Для попа также проверь [usePopComments](../../src/features/pops/PopViewer/usePopComments.ts).
- Корни и ответы загружаются обычными страницами; окна вокруг целевых комментариев удалены.
  Открытие ветки ответов, ручная догрузка и показ своего отправленного ответа сохраняются.
- Меняешь отправку/аудиторию — [права записи](../product.md#права-записи-и-обещания-приватности);
  доступ к цели/тексту — [видимость сообщений](../product.md#видимость-сообщений).
- Кластеры — отдельные расчёты и серверная функция. Правка геометрии шита сама по себе не требует
  чтения/переобучения модели кластеров или изучения всего журнала рекомендаций.

## Проверить изменение

[comments.test](../../src/api/comments.test.ts), [commentsCache.test](../../src/features/interactions/comments/commentsCache.test.ts),
[rows.test](../../src/features/interactions/CommentsPanel/rows.test.ts),
[comment_threads_access.sql](../../supabase/tests/comment_threads_access.sql),
[comment_forwards_access.sql](../../supabase/tests/comment_forwards_access.sql) — выбирать по изменению.

Maestro: [comments-sheet](../../.maestro/comments-sheet.yaml), [comment-thread](../../.maestro/comment-thread.yaml),
[fragment-panel](../../.maestro/fragment-panel.yaml). Сначала проверь тестовые данные по [device](../../.agents/skills/device/SKILL.md).
Для фокуса проверь открытие сразу на нужном ответе и быстрый переход к другой цели;
для вида — нужный шит/панель и клавиатуру. Эти сценарии не доказывают скорость перехода.
