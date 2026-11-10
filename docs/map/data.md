# Данные, API и интеграции

Указатель для изменения данных или прав. Сверено с `b123c6b`, 08.11.2026.
Это маршрут к реализации, не копия справочника БД. Контракт ищи по таблице ниже;
нормативные разделы выбирай по изменению в блоке «Какие правила нужны».

## Найти контракт

<!-- prettier-ignore -->
| Задача | Клиент → объекты для поиска в SQL |
| --- | --- |
| Аккаунт и устройства | [account](../../src/api/account.ts): `devices`, `register_device`, `end_device_session`; [profile](../../src/api/profile.ts): `profile_cards` |
| Переписка и история | [chats](../../src/api/chats.ts), [messageRows](../../src/api/messageRows.ts): `chat_rows`, `my_chat_list`, `send_media_message`, `edit_message`; [chatThreads](../../src/api/chatThreads.ts): `list_chat_thread` |
| Участок истории и продолжение в обе стороны | [historyWindow](../../src/api/historyWindow.ts): `get_history_element_window`, `history_element_rows`, `history_window_elements`; [контракт](../backend.md#участок-истории), [SQL-проверки](../../supabase/tests/history_window_access.sql) |
| Комментарии и реакции | [comments](../../src/api/comments.ts), [reactions](../../src/api/reactions.ts): `comment_rows`, `list_comment_thread_roots`, `send_comment`, `set_reaction` |
| Каналы, попсы и подписки | [channels](../../src/api/channels.ts), [pops](../../src/api/pops.ts), [subscriptions](../../src/api/subscriptions.ts): `channels`, `pops`, `subscriptions`, `subscribe_to_chat`, `subscribe_to_channel` |
| Сохранённые и заметки | [saved](../../src/api/saved.ts): `saved_messages`, `saved_tags`, `list_saved_messages`, `list_saved_watch_later` |
| Друзья, блокировки, приватность | [friends](../../src/api/friends.ts), [blocks](../../src/api/blocks.ts), [privacy](../../src/api/privacy.ts): `friendship_status`, `my_privacy_settings`, `privacy_allows`, `person_card` |
| Поиск и журнал рекомендаций | [search](../../src/api/search.ts), [recJournal](../../src/api/recJournal.ts): `search_entities`, `search_messages`, `search_pops`, `rec_record_events`; журнал не равен готовой ленте |
| Звонки и эфиры | [streams](../../src/api/streams.ts): `start_call`, `chat_live_stream`, `my_ringing_streams`, `stream_people` |
| Файлы и аватары | [Медиа](media.md): Storage, `media_objects`, `sanitize-media`; доступ и подписи — [chatMedia](../../src/api/chatMedia.ts), [avatars](../../src/api/avatars.ts) |

1. Начни с вызова в клиенте: прочитай запрос, параметры RPC и обработку результата.
2. Ищи точное имя в [миграциях](../../supabase/migrations/): `rg -n 'имя' supabase/migrations`.
   Прочитай определения и последующие изменения по времени, включая вызываемые функции,
   политики и grants. Одна ранняя миграция не описывает текущий контракт целиком.
3. [types.gen](../../src/api/types.gen.ts) — генерируемые типы; [database](../../src/api/database.ts)
   уточняет типы представлений. Они не заменяют SQL/RLS и не подтверждают применение миграций на сервере.
4. Выбери существующую проверку по домену в [supabase/tests](../../supabase/tests/):
   `chat_threads_access`, `comment_threads_access`, `chat_subscriptions_access`, `privacy_*`,
   `saved_*`, `calls_access` и другие. Порядок запуска и среда — [миграции и типы](../backend.md#миграции-типы-переменные-окружения);
   это указатель, не требование прогонять весь SQL-набор.

## Какие правила нужны

- Меняешь схему/доступ: [правила схемы](../backend.md#правила-схемы), [RLS](../backend.md#row-level-security).
  Для доменного описания найди только нужный подраздел: `node .agents/scripts/read-doc.mjs docs/backend.md`.
- Меняешь имена/профили/возрастные ограничения: [видимость людей](../product.md#видимость-людей).
- Меняешь публикацию/текст/цитаты/вложения: [видимость сообщений](../product.md#видимость-сообщений).
- Меняешь события: [Realtime](../backend.md#realtime) → [chatTopics](../../src/api/chatTopics.ts),
  [commentTopics](../../src/api/commentTopics.ts), [popTopics](../../src/api/popTopics.ts) → SQL-политики тем.
- Меняешь звонки или авторизацию: [стримы](../backend.md#стримы) или [авторизация](../backend.md#авторизация).

## Внешние связи

<!-- prettier-ignore -->
| Сервис/поток | Исходник и граница ответственности |
| --- | --- |
| Supabase на собственном сервере | [supabase client](../../src/api/supabase.ts), [docker-compose](../../infra/docker-compose.yml), [Caddyfile](../../infra/Caddyfile): Auth, PostgREST, Realtime, Storage, Edge Functions |
| Очистка загрузок и удаление аккаунта | [sanitize-media](../../supabase/functions/sanitize-media/handler.ts), [delete-account](../../supabase/functions/delete-account/handler.ts) |
| Кластеры фрагментов | [fragment-clusters](../../supabase/functions/fragment-clusters/handler.ts) и его тесты; API — [fragmentClusters](../../src/api/fragmentClusters.ts) |
| LiveKit/TURN | [livekit config](../../infra/livekit.yaml); функции [token](../../supabase/functions/livekit-token/handler.ts), [webhook](../../supabase/functions/livekit-webhook/handler.ts), [sync](../../supabase/functions/livekit-sync/handler.ts). Роль и доступ выдаёт сервер |
| Маршрутизация функций | [functions/main](../../supabase/functions/main/), общие помощники — [functions/_shared](../../supabase/functions/_shared/) |

Список конфигураций не требует читать секреты или подключаться к серверу. Не копируй значения
из `.env`, резервных копий и аккаунтов в карту/промпт. Код репозитория и состояние развёртывания
проверяются отдельно; не запускай миграции или облачную сборку просто ради чтения карты.
