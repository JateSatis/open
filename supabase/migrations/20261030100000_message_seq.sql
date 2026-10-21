-- Номер сообщения — курсор без времени.
--
-- Приватность, этап 2: у части зрителей время сообщений скрыто (настройка
-- «Кто видит время сообщений и прочтение»), а листание истории, дочитывание
-- новых и переход к сообщению шли по `created_at`. Номер `seq` раскрывает
-- только порядок — а порядок и так виден по самой переписке.
--
-- Один счётчик на все сообщения: монотонный, уникальный, растёт со временем
-- вставки. Засеян по (`created_at`, `id`), поэтому старые сообщения стоят в
-- том же порядке, что и раньше. Пишет его только база (`generated always`).
--
-- Поиск сообщений по всем моим чатам идёт тем же номером от новых к старым:
-- уникальный индекс по `seq` держит этот порядок.

alter table public.messages add column seq bigint;

update public.messages m
set seq = numbered.n
from (
  select id, row_number() over (order by created_at, id) as n
  from public.messages
) numbered
where numbered.id = m.id;

alter table public.messages alter column seq set not null;
alter table public.messages alter column seq add generated always as identity;

select setval(
  pg_get_serial_sequence('public.messages', 'seq'),
  greatest((select max(seq) from public.messages), 1),
  (select count(*) > 0 from public.messages)
);

create unique index messages_seq_key on public.messages (seq);

-- Страница переписки: свежие сверху, только живые.
create index messages_chat_seq_idx
  on public.messages (chat_id, seq desc)
  where deleted_at is null;

-- Вкладки страницы информации о чате — тем же номером.
create index messages_chat_media_seq_idx
  on public.messages (chat_id, seq desc)
  where kind = 'media' and deleted_at is null;

create index messages_chat_voice_seq_idx
  on public.messages (chat_id, seq desc)
  where kind in ('voice', 'video_note') and deleted_at is null;
