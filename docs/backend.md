# Бэкенд

Читай по необходимости: БД, схема, RLS, авторизация, Realtime, стримы, уведомления, миграции,
переменные окружения. Справочник по схеме; сами миграции — единственный источник правды в
`supabase/migrations/`.

## Авторизация

Только OAuth (Google и Apple обязательны; Apple — требование App Store, раз есть Google; дальше —
другие провайдеры), без email/телефона намеренно. Сейчас: нативные листы
(`expo-apple-authentication`, `@react-native-google-signin/google-signin`), id-токен →
`supabase.auth.signInWithIdToken`. Клиент Supabase — один раз в `src/api/supabase.ts`: `AsyncStorage`,
`autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`; обновление токена
привязано к `AppState` (фон — пауза, возврат — запуск). Состояние читается **только** через
`useSession()` из `src/features/auth` (один `onAuthStateChange`); прямых `getSession()` в компонентах
нет. Отмена входа — не ошибка; сетевые/серверные сбои — человеческим текстом. Включение провайдера
— действие в дашборде Supabase (просьба к человеку).

## Модель данных

Сквозное различие: читать чат может любой, писать — только участник; взаимодействие посторонних —
отдельные таблицы, никогда не смешивается с `messages`.

- `profiles` — 1:1 с `auth.users`; username необязателен, уникален по `lower(username)`. Имя,
  username, `avatar_url`, «О себе», статус клиенту не читаются — только через `person_card`:
  `profile_cards(ids)` вне диалогов (каталога нет, только по id) и колонки в строках/функциях.
  Свои колонки владелец пишет; фото — только свой файл (`guard_profile_avatar`).
- `identity_secret` — одна строка, секрет псевдонимов и непрозрачных id: HMAC(чат, человек) →
  `chat_alias` и `chat_opaque_id`; в звонке — `stream_identity`. Закрыта целиком.
- `follows` — подписки на людей: отложено, таблицы нет и не заводить без решения человека.
- `privacy_settings` — 1:1 с профилем (cascade): дата рождения (видит только владелец) + по колонке
  на настройку `everyone|friends|nobody` (домен `privacy_visibility`). Создаётся в `handle_new_user`
  с защитными (подростковыми) значениями; `set_birth_date` (младше 13 — OPN04, будущее — OPN03)
  выставляет по возрасту один раз (`initialized_at`); значения по умолчанию — только
  `privacy_default_settings`. Читает сам (`my_privacy_settings`), пишут `set_birth_date`/
  `set_privacy_setting`; применение — только `privacy_allows` (сам видит всё, friends — `are_friends`).
  Без даты > суток и без активности сеанса за сутки — удаляет `delete_abandoned_accounts` (pg_cron).
  Отказы даты — по UTC+14 (`latest_local_date`), значения по возрасту — по UTC, в сторону защиты.
  `identity_alias` — общий псевдоним (словари с родом в миграции), триггер; смена —
  `regenerate_identity_alias` (5/сутки, OPN13). Три настройки идентичности
  (`profile_identity_masking`, `dialogue_participant_name_masking`, `avatar_visibility`) применяет
  только `person_card`: в диалоге, где человек участник, а зритель нет, закрытая `dialogue_…` —
  псевдоним чата + непрозрачный id без фото; иначе `profile_…` — общий псевдоним без username/«О
  себе»/статуса, `avatar_…` — без фото. Блокировка скрывает в одну сторону (`identity_allows`).
  Смена этих настроек/псевдонима — сигнал `people_changed` в топики чатов человека.
  `dialogue_media_visibility` применяет `media_visible(автор, чат, канал)`: медиа человека видят сам,
  участники чата, остальные — по настройке; пост канала — всем; смена — `media_changed`.
- `friendships` — одна строка на пару (unique least/greatest), requester → addressee,
  `pending|accepted|declined`; друзья — только accepted (`are_friends`). Отказ отправителю не
  раскрывается: declined — «Заявка отправлена»; отменённая после отказа — `withdrawn_at`, не
  тревожит снова; встречное «Добавить» = принятие. Закрыта; функции: send/cancel/accept/
  decline_friend_request, remove_friend, friendship_status, friends_summary, list_friends (по
  `friends_list_visibility`), list_incoming_friend_requests. Каскад от обоих.
- `friend_request_log` — отправленные заявки для лимита `send_friend_request` (30/час, 100/сутки,
  OPN05); закрыта, >2 суток чистит pg_cron.
- `dialogue_requests` — история заявок на диалог по паре (outcome null/declined/cancelled/accepted).
  Повтор — `check_dialogue_retry`: после отказа/отмены не раньше `dialogue_retry_days`, после
  `dialogue_max_refusals` — никогда, пока второй сам не напишет (OPN09); отмена = отказ, отправителю
  не раскрывается. Закрыта, каскад от обоих.
- `contact_request_log` — обращения к не-друзьям для `check_contact_request_limit`
  (`contact_requests_per_day` на все аккаунты устройства, OPN10); закрыта, >2 суток pg_cron.
- @имена — у человека/канала/группы раздельные пространства, общего реестра нет (`@max`, `@max.ch`,
  `@max.di` — суффикс не хранится). Алфавит (латиница, цифры, `_`, без точки) — CHECK; длина/регистр
  — клиент (`username.ts`); свободно ли — `is_username_available(вид, имя)`.
- `channels` — название, описание, username (обязателен, уникален среди каналов), аватарка, владелец,
  `posts_chat_id` (1:1 чат постов). Пишут только `create_channel`; права/роли — свойство канала.
  Счётчики `subscribers_count`/`readers_count`, `last_pop_at` — триггерами.
- `subscriptions` — человек + ровно одно из `channel_id|chat_id` (чат — этап 2, пока запрещён
  проверкой). `in_chats` — читатель, `notify` — карточки, `messages_read_at`/`pops_read_at` — отметки
  серверным временем. Подписчик не становится `chat_members`. Читает только сам; функции:
  subscribe_to_channel, set_channel_in_chats, set_channel_notifications, unsubscribe_from_channel,
  mark_channel_read; непрочитанное — my_channel_subscriptions, список — list_channel_subscribers
  (владелец). Отписка удаляет строку физически (не публичный контент). Публикующий в канале не
  подписывается.
- `chats` — kind `direct|group|channel_posts`; у чата постов названия нет (имя из канала). `owner_id`
  — только у группы (CHECK); настраивает группу и удаляет участников только владелец
  (`can_manage_chat`); `created_by` — история (владение переходит: уход/удаление владельца → самый
  давний участник → null). Прямого UPDATE у клиента нет: title — `set_chat_title`, description
  (только группа) — `set_chat_description`, username (только группа, уникален) — `set_chat_username`,
  avatar — `set_chat_avatar`/`create_chat`; все set_* с правом владельца. Адрес аватара — существующий
  файл бакета `{свой id}/group-avatar/`, один файл — одна группа. Личка удаляется для всех
  (`delete_direct_chat`). `time_restricted` — есть участник с настройкой времени не «Все» (триггеры
  chat_members/privacy_settings; у чата постов — никогда). `last_message_at` — вычисляемое; порядок/
  непрочитанное — `my_chat_list`; превью — `last_message_preview` (заглушка для заблокировавшего;
  колонку `last_message_text` не закрыть — вычисляемым полям нужны права на все колонки).
  `request_pending` — личка-заявка от не-друга: создаёт `create_chat` (с `request_text` — чат+заявка+
  первое сообщение одной транзакцией; без текста — ответ `request_needed`), снимает принятие
  `open_dialogue_request`; до принятия всё видно только двоим (`founding_member_ids`); второе
  сообщение/не-текст/правка медиа/звонок — отказ триггерами (OPN07). Личка с другом — сразу оба.
  `last_message_text` — превью для зрителей; показывают превью `chat_preview_for`/`last_message_preview`.
  `public_hold_seq` — водораздел публикации; читать видимость — `chat_public_hold`.
- `chat_members` — единственные, кто пишет сообщения; только функции (create_chat, accept_chat_invite,
  leave_chat, remove_chat_member). `last_read_at`/`joined_at` клиенту не читаются — участники с
  отметками через `chat_people`; посторонний видит состав только через `chat_people`.
- `chat_invites` — pending|accepted|declined; статус видит только приглашённый, остальным —
  `chat_waiting_invitees`. Зовёт любой участник (`invite_to_chat`), отменяет владелец
  (`cancel_chat_invite`).
- `messages` — текст, фото, видео, голосовое, кружок, системное, островок пересылки `forward`
  (`source_chat_id` — заголовок). Островок — не сообщение: реакции/комментарии/цитаты/закреп/правку не
  принимает (отказ в базе). Системные (`member_invited|member_joined|member_left|member_removed|
  owner_changed`): имена в тексте — на момент записи, клиенту собирает `message_rows`. `author_id`/
  `system_user_id`/`text` из таблицы клиенту не читаются. `seq` — монотонный курсор страниц (вместо
  времени). Время (`created_at`/`edited_at`/`read_at`) и сырые просмотры (`views_count` и т.п.)
  клиенту не читаются — читать из `message_rows`. Новая колонка `messages` не видна, пока её нет в
  grant и `message_rows`. `hidden_ranges` — int4multirange (code points, только у text/media с текстом);
  `public_text` — вычисляемый. Пишут: `send_media_message(…, hidden)`, прямая вставка текста,
  `edit_message(…, hidden)`, `set_message_hidden` — только автор, не правка. `delayed_until` — своя
  задержка владельца `public_message_visibility_delay` (личка/группа, 1–30 мин, gen_random_bytes);
  `public_at` — когда видят зрители (не раньше своей задержки и любого неопубликованного перед ним;
  ставит триггер). `chat_public_hold` — номер самого раннего живого неопубликованного; зрителю —
  только ниже. Удалённое неопубликованное водораздел не держит. Публикацию рассылает
  `release_public_messages` (pg_cron 15 с) и `release_chat_messages`.
- `message_rows` — сообщения глазами смотрящего (повтор SELECT-политики messages): время null, если
  скрыто (`chat_time_visible`), прочтение/просмотры по `chat_reads_visible` (взаимно), правка —
  `edited`/`edit_mark`; свои связи `my_reaction`/`reactors`/`my_stream_participation`. Embed — только к
  нему. `hidden` — сообщение заблокировавшего, где смотрящий не участник: строка остаётся (seq,
  цитаты), текст/счётчики/реакции пусты, вложений нет. Связи PostgREST — только из прямых колонок
  одного источника: внешние ключи не оборачивать в выражения и не джойнить. Люди — колонками глазами
  смотрящего (`author_opaque`/`system_user_opaque`, `author_name`, `author_avatar_url`,
  `system_user_name`; `message_people(id)`), функции в представлениях ключуются id строки;
  `person_card` клиенту закрыт. Текст — `message_seen_text`; не-участнику — только ниже водораздела,
  время `public_at`, правка до публикации не видна (`message_seen(id)`).
- `comment_rows` — комментарии глазами смотрящего (SELECT-политика comments + заглушка удалённого
  корня); `list_comment_thread_roots`, `pinned_comment`, свои `my_reaction`/`reactors`.
- `reactor_rows` — реакции с человеком глазами смотрящего; `reactors(message_rows|comment_rows)`.
  Строки `reactions` клиенту — только свои.
- `chat_rows` — чаты глазами смотрящего (SELECT-политика chats; `chat_row_people` для owner_id/
  created_by/last_message_author_id); вычисляемые клиента (`chat_display_name`, `last_message_preview`,
  `last_message_at`, `chat_read_up_to`, `chat_am_member`). Колонки `owner_id`/`created_by`/
  `last_message_author_id`/`last_message_text`/`founding_member_ids` таблицы клиенту не читаются →
  строку chats целиком клиент не читает.
- `attachments` — медиа сообщения: свой файл (`url`/`poster_url` в chat-media, очищенные в
  `media_objects`, триггер `guard_attachment_object`) или ссылка на поп (`pop_id`). Клиенту — только
  `attachment_rows`. Ссылку кладут только `publish_pop`/`send_pop_post`, поп того же канала; сейчас
  одна на пост (`check_message_shape`), правкой не убрать/заменить; альбом «медиа+попсы» — ослабление
  этих проверок.
- `pops` — вертикальное видео канала: постер, размеры, длительность, title (обязателен, поиск
  `search_pops`), подпись. Не сообщение/чат; пишут только функции публикации, право —
  `can_publish_in_channel`. Свои реакции/просмотры/комментарии, отдельные от поста; сигналы —
  `pops:<channel_id>`.
- `pop_views` — пара поп+зритель; повторный показ ≤ 1/10 с; публикующие в канале не считаются; пишет
  только `record_pop_views`; закрыта.
- `forward_items` — позиции островка (ссылка на первоисточник); пишут `forward_messages`/
  `remove_forward_items`; заголовок подделать нельзя. Ответ/закреп облачка помнят островок
  (`message_replies.quoted_forward_id`, `message_pins.forward_id`).
- `legacy_forward_copies` — журнал переноса старых копий; только модерация.
- `fragment_rows` — фрагменты глазами смотрящего (`exact_text` = `fragment_seen_text`); якорь/контекст
  (exact/prefix/suffix) клиенту не читаются.
- `message_fragments` — фрагмент текста [start,end) code points + якорь exact/prefix/suffix, автор,
  свои реакции и comments_count. Рождается спящим (`deleted_at`) первой реакцией/комментарием
  (`set_fragment_reaction`, `send_comment`/`send_voice_comment` с fragment), засыпает без них; один
  живой на автора и диапазон. Правка перепривязывает (`anchor_state` exact|shifted|lost). Пишут только
  функции; список — `list_message_fragments`; зритель не выделяет кусок со скрытым/неопубликованным
  (`ensure_fragment`). `cluster_id` — составной FK; пересекающий кластер входит сразу
  (`attach_fragment`).
- `fragment_clusters` — кластер фрагментов: диапазон модели и отображаемый (`display_start/end`,
  ≤200, по словам, без пересечений), популярность, сводные реакции, comments_count, people_count.
  Модель — `_shared/fragmentClusters.ts`; очередь pgmq `fragment_clusters`, заявки
  `fragment_clusters_touch` (до 20, дальше пороги) → pg_cron → Edge Function `fragment-clusters`.
  Читают все (отображаемые живого сообщения, `list_message_clusters`); пишут функции. Одна живая
  реакция на человека (`replace_cluster_reaction`, advisory-блокировка пары). `decision_id` — снимок
  решения.
- `fragment_cluster_voters` — кто голосовал (реакции+комментарии) для people_count; удалённый —
  user_id null; закрыта.
- `fragment_cluster_state` — счётчик, последний пересчёт, заявка, аренда (≤1 на сообщение); закрыта.
- `fragment_cluster_config` — параметры модели/порогов по версиям (наибольшая; вставка строки);
  закрыта.
- `fragment_cluster_worker` — последний вызов (pg_net); одна строка; закрыта.
- `fragment_cluster_decisions` — журнал решений (контекст, веса, впадины, варианты с признаками/
  оценками); без текста; для обучения; ретенция `historyRetentionDays` (pg_cron), текущий снимок не
  удаляется; закрыта.
- `fragment_cluster_events` — показ/панель/реакция/комментарий/цитата; сервер пишет `fragment_created`
  из `ensure_fragment`; клиент — `record_fragment_cluster_events` (от своего имени, пачка/частота,
  повтор показа в окне не пишется); закрыта.
- `message_revisions` — прежние версии после правки; только модерация; закрыта.
- `message_views` — пара сообщение+зритель; счётчики `views_count`/`unique_views_count`, прочтение
  `read_at`; пишет только `record_message_views`; закрыта.
- `comments` — к сообщению или попу (ровно одно из message_id|pop_id), от любого. Ключ цели —
  `target_id = coalesce(message_id, pop_id)`; чат у сообщения — чат сообщения, у попа — чат постов
  (триггер). `audience` member|visitor ставит база (у попа — `can_publish_in_channel`). Счётчик —
  `messages.comments_count`/`pops.comments_count`. Отправка: send_comment/send_voice_comment
  (сообщение), send_pop_comment/send_voice_pop_comment (поп), верх — `list_comment_thread_roots(target,
  …, fragment)`; `fragment_id` — у корня.
- `comment_attachments` — как attachments; клиенту — `comment_attachment_rows`.
- `attachment_rows` / `comment_attachment_rows` — вложения глазами смотрящего: скрытое настройкой —
  url/poster_url/waveform null + `media_hidden` (вид/размеры/длительность остаются); клиент встраивает
  с псевдонимом `attachments:attachment_rows(…)`. Новая колонка не видна без представления.
- `media_objects` — реестр очищенных файлов (бакет, путь, владелец, вид, тип, размер, когда очищен);
  пишет только `sanitize-media`, читают проверки `media_object_owned`; закрыта; каскад от профиля.
- `comment_replies` — цитаты ответа (только та же ветка, ≤100); пишут функции отправки.
- `comment_pins` — закреплённый комментарий цели (target_id+comment_id), один живой, только корень;
  право — автор контента (`comment_pin_right`); пишут pin_comment/unpin_comment; читают все; сигнал
  `comment_pin_changed` в `comments:<target_id>`.
- `comment_revisions` — прежние версии; только модерация.
- `reactions` — полиморфные (message|comment|pop|fragment + target_id), audience ставит база, одна
  живая на человека и цель; счётчики — в строке цели.
- `reaction_emojis` — справочник с валентностью (−1…1); меняется только миграцией.
- `posts` — самостоятельные публикации; `excerpts` — фрагмент переписки (чат+диапазон);
  `streams` — публичный звонок (LiveKit, хост, статус; `host_id` клиенту не читается —
  `chat_live_stream`/`my_ringing_streams`); `stream_participants` — host|speaker|listener (читает
  только сам; кто в эфире — `stream_people`); `stream_identities` — identity комнаты (не id человека;
  `stream_join_info`, вебхук `stream_identity_user`; закрыта); `clips` — вырезка из стрима;
  `feed_items` — единая лента (excerpt|post|clip + сигналы ранжирования).
- `rec_*` — журнал рекомендаций (будущая обучающая выборка): всё закрыто (RLS без политик), кроме
  своих строк скрытия; без облака, переезжает на свой Postgres. `rec_config` — параметры по версиям
  (`rec_settings()`); `rec_events` — типизированные действия, append-only, партиции по дню в
  `rec_parts` (`rec_partitions_maintain`), клиент — `rec_record_events` (пачка/дедуп/правдоподобие),
  сервер — триггеры через `rec_log`; `rec_event_keys` — дедуп (человек+client_event_id);
  `rec_reject_counts` — отказы/дубли по дням; `rec_impressions` — показ (`impression_id`), свёртка
  `rec_rollup`; `rec_pop_*`/`rec_pop_heat`/`rec_pop_viewers` — агрегаты попа (почасовые корзины 48 ч,
  тепловая карта, уникальность зрителя); `rec_app_sessions` — сессии; `rec_hidden_pops`/
  `rec_hidden_channels` — «не интересно» (`set_pop_not_interested`/`set_channel_hidden`, подписка на
  канал снимает скрытие).
- `saved_messages` — личные копии сообщений/комментариев (не публичный контент; только владелец,
  каскад). Снимок увиденного при сохранении (вид, текст, время — null если скрыто, автор — id если
  виден, иначе снимок имени; клиенту колонка закрыта, автор глазами владельца в
  `list_saved_messages`); правка/удаление/блокировка оригинала копию не меняют. Категория
  channel|member|visitor; «Посмотреть позже» `watch_later_at`/`watch_done_at`; закреп `pinned_at`.
  Функции (чужой id — P0002): save_messages/save_comments, set_saved_tag, set_saved_watch_later,
  restore_saved_watch_later, set_saved_pinned, delete_saved_messages; страницы list_saved_messages /
  list_saved_watch_later / list_saved_pins; строка — `saved_rows`; фильтр `p_filter` jsonb (tags/
  categories/types/from-to/q) и count_saved_messages; вид — `saved_type` (voice|pop|text_media);
  источник — `saved_source`; пересылка пачки — `saved_forwardable`; счётчик — `saved_summary`.
  Заметка — `source_type = note`: без источника, автор владелец, `original_at`/`edited_at` (прежняя
  версия не хранится), `client_id`; пишут send_saved_note / edit_saved_note (копию — 42501) /
  copy_saved_notes; в чат уходит обычным сообщением её же файлами. Строки страниц несут `edited` и
  `replies`.
- `saved_message_attachments` — снимок вложений (те же пути, файлы не копируются); у поста с попом —
  поля попа; у заметки — только очищенные файлы владельца (`guard_saved_note_object`, OPN14).
- `saved_note_replies` — цитаты ответа заметки (записи того же владельца, ≤100; удалённая — `quoted_id`
  null + «Запись удалена»).
- `saved_tags` — имя (unique lower), цвет (палитра 12), uses_count триггером; `saved_message_tags` —
  связь копия-тег (составные ключи с владельцем).
- `devices` — сеансы Supabase + push-токены; приватная.
- `user_presence` — «в сети»/«был(а)» по сеансу (user_id+session_id из JWT): `last_seen_at`,
  `online_until`; пишет `mark_seen(online)` (раз в минуту + уход в фон); читает
  `activity_statuses(ids)` с `privacy_allows('activity_status_visibility')`; общего Presence-канала
  нет; закрыта, каскад.
- `search_request_log` — журнал поиска для `search_rate_hit` (120/мин, 1200/час, 5000/сутки, OPN06);
  закрыта, >2 суток pg_cron.
- `notifications` — лента уведомлений в приложении.
- `account_installations` — история «аккаунт — установка» (`installation_id`): register_device/
  touch_device; `linked_accounts`; закрыта, каскад.
- `blocks` — кто кого (unique пара); свои строки читает сам; пишут block_user (одной транзакцией рвёт
  дружбу, заявки в друзья/чаты/диалоги в обе стороны), unblock_user, report_user; `blocked_pair(a,b)`
  — в любую сторону + аккаунты устройства; my_blockers/my_block_peers; заблокированному отказ — как
  недоступность (OPN08); каскад от обоих.
- `reports` — жалобы (кто/на кого/цель/причина/комментарий); пишет report_user (лимит `reports_per_day`,
  OPN12); читает сервисная роль; ссылки set null.
- `account_restrictions` — автоограничение: auto_restrict_actors за `auto_restrict_window_hours`
  заблокировали/пожаловались → `restricted_until` на `auto_restrict_hours` (триггеры blocks/reports);
  `contact_restricted` — и по аккаунтам устройства; ограничен: заявки не-друзьям (OPN11), поиск —
  только знакомые; закрыта.
- `safety_config` — пороги по версиям (`safety_settings()`); вставка строки; закрыта.

**Правила схемы:**
- каждая таблица: `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`.
- мягкое удаление `deleted_at`, физически строки не удаляются.
- `messages` — самая горячая; индексы по `chat_id`+`created_at` обязательны; выборка всегда
  постраничная («весь чат» не существует).
- счётчики (реакции, комментарии, слушатели, подписчики) денормализованы в родительской строке и
  обновляются триггером, не агрегатом на каждый запрос ленты.
- `excerpts` ссылается на диапазон, не копирует текст (фрагмент отражает правки/удаления).
- `feed_items` — единая точка ранжирования; новый тип — ссылка отсюда, не отдельная лента.
- приватные данные (`devices`, `chat_members`) — `on delete cascade`; публичная история — любой FK на
  `profiles` — `on delete set null`.
- **инварианты — в схеме, продуктовые лимиты — на клиенте.** Нарушение ломает отрисовку/фичи → БД
  (CHECK, составной FK, частичный unique); неудобный UX → клиент. Клиентская проверка при прямом
  PostgREST не защита (anon key в бандле) — инварианты обязаны жить в БД.
- новая таблица — сразу с RLS-политиками, индексами и местом в списке выше.

## Row Level Security

RLS — на каждой таблице без исключений (таблица без политик = таблица, которой нет).
- SELECT — открыт аутентифицированным почти везде, кроме `deleted_at is not null` и контента
  заблокировавших; люди — глазами смотрящего (`person_card`): колонки с людьми у profiles/messages/
  comments/chats/streams/message_fragments/*_pins закрыты правами, строки reactions/chat_members/
  stream_participants — политикой; клиент читает представления (message_rows, comment_rows,
  reactor_rows, chat_rows) и функции. Подзапрос в политике читает закрытое функцией с правами владельца.
- INSERT в `messages` — только если `auth.uid()` ∈ `chat_members` чата (центральная политика).
- INSERT в `comments`/`reactions` — любому аутентифицированному (нельзя запретить, включены везде);
  то же про реакции на комментарии и `comment_replies` (только в транзакции отправки своего).
  `chat_settings` нет и не планируется. Исключение — блокировка: из пары с блокировкой никто не
  комментирует/реагирует на сообщения/комментарии/ветки другого (OPN08, `prepare_comment`/
  `prepare_reaction`), и паре друг друга не показывается (SELECT-политики, `list_comment_thread_roots`);
  посты/попсы канала — контент канала, исключение не касается; на непринятую заявку на диалог никто
  не откликается.
- блокировка в messages: в личку двоих с блокировкой не пишет/не звонит никто (`guard_message_contact`/
  `guard_stream_contact`); сообщения заблокировавшего, где заблокированный не участник, — заглушка
  (`message_rows.hidden`); профиль заблокировавшего не читается (политика `profiles`).
- UPDATE/DELETE — только автор строки.
- содержимое messages (текст, вид, вложения, edited_at, deleted_at) — только функциями: `edit_message`/
  `delete_messages`; вложения — только в транзакции отправки.
- `message_revisions` — RLS есть, политик нет (только сервисная роль).
- `reports` — вставлять каждый, читать только сервисная роль.
- чат постов (`channel_posts`): участники — только функции канала (create_channel → владелец);
  подписчики/читатели участниками не становятся (иначе писали бы посты); вставка в chat_members мимо
  функции, заявки (chat_invites) и звонки (streams) для чата постов отказывают триггером по виду.
- `pops` — читают все, пишут только publish_pop (поп + по флагу пост одной транзакцией) и
  send_pop_post (обе с `can_publish_in_channel`); удаление поста поп не трогает.
- `comment_pins` — читают все, пишут pin_comment/unpin_comment; право (автор) — в функции, не в
  скрытии меню.
- `devices` — исключение из открытого SELECT (модель/время не публичны): читает владелец, пишут
  register_device/touch_device/end_device_session/end_other_sessions (session_id из JWT).
- `profiles` — владелец меняет только перечисленные колонки; `deleted_at`/`id`/служебные с клиента не
  пишутся; профиль исчезает только с аккаунтом (Edge Function `delete-account`).
- политики — в миграции вместе с таблицей.

## Realtime

- Сообщения в чате, «печатает», события стрима — **Broadcast**, не Postgres Changes (RLS на каждое
  изменение для каждого подписчика — дорого на публичном мессенджере).
- Presence — только «кто слушает стрим». «В сети»/«был(а)» — не Presence (см. `user_presence`).
  «Печатает» шлёт клиент туда, куда разрешает база (`my_typing_audience`): `chat:<id>`,
  `chat-members:<id>` (только участники) или никуда; в `chat:<id>` — только как участник; при
  задержке публикации у участника — только участникам.
- Сигналы о ещё не видимом зрителям (новое, реакции, комментарии, правки, удаления, закрепы,
  просмотры, кластеры, фрагменты, островки, прочтение) — только в `chat-members:<id>`
  (`message_signal_topic`/`chat_signal_topic`); зрители получают new_message/pins_changed/read в
  момент публикации и перечитывают строки.
- Payload рассылок о сообщениях — без времени; смена настройки времени — `time_visibility_changed`.
- В общих топиках (`chat:<id>`, `comments:<id>`, `pops:<id>`) людей нет (ни id, ни имён) — клиент
  перечитывает строки; в личном `user:<id>` человек — глазами получателя. «Печатает» с настоящим id —
  только участникам (`my_typing_audience`). Смена имени/фото — `people_changed` в топики чатов.
- Postgres Changes — только персональные подписки малого объёма (уведомления).
- Отправленное сообщение — оптимистично сразу, с состоянием доставки.
- Отписка от канала обязательна в cleanup `useEffect` (утёкшие каналы — частая причина потери
  событий).
- Топики `chat:<id>` — только через реестр `src/api/chatTopics.ts` (счётчик слушателей; иначе отписка
  одного глушит остальных). Островки слушают топики чатов-источников.

## Стримы

Пакеты: livekit-client, @livekit/react-native, @livekit/react-native-expo-plugin,
@livekit/react-native-webrtc, @config-plugins/react-native-webrtc. Оба плагина — в `plugins` `app.json`,
в точке входа `registerGlobals()` (без него не работает), нужна новая сборка dev build.
- токен комнаты — только Edge Function; API-секрет LiveKit никогда в клиенте.
- identity в токене — непрозрачный id звонка (`stream_join_info` → `stream_identities`), имени нет;
  кто за identity — `stream_people`.
- роли в токене: слушатель `canPublish: false`, `canSubscribe: true`; права — на сервере, не скрытием
  кнопки.
- повышение до спикера — новый токен у Edge Function с согласием хоста.
- звонок становится публичным без отдельных действий звонящего, но заметно для него.
- `AudioSession` — до входа в комнату, закрывается при выходе.

## Уведомления

Expo Push, токены `devices.push_token`, отправка из Edge Function; триггер на вставку в
`notifications` ставит задачу, отложенные/регулярные — pg_cron. Токен обновляется при запуске,
удаляется по `DeviceNotRegistered`. Пуш о новом сообщении — быстрый, схлопывается по чату, открывает
нужный чат.

## Миграции, типы, переменные окружения

- схема — только миграцией (не веб-панель); имя `<timestamp>_<что>.sql`; применять `npx supabase db
  push` после `supabase link` (не залинкован/нет пароля — просьба к человеку);
- после изменения схемы: `npx supabase gen types typescript --linked > src/api/types.gen.ts`;
- компоненты не зовут `supabase.from(...)` напрямую — только функции из `src/api/`.
- В клиенте ровно две переменные: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  (в `.env`, не коммитится). `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_KEY/SECRET` — только секреты
  Edge Functions. `EXPO_PUBLIC_` = попадает в бандл. Публичные id (client ID Google, `iosUrlScheme`)
  — в `app.json` (extra и плагины), не секреты.
