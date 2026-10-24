-- Заметки «Сохранённых»: правки после ревью.
--
-- 1. Удалить неотправленную заметку по ключу повтора. Человек убрал заметку,
--    пока ответ сервера терялся в обрыве: она могла создаться — клиент не
--    знает её id, а ключ знает. Нет такой — ничего.
-- 2. Правка заметки: повтор вложения в списке оставляемых — отказ, а не
--    случайный порядок альбома.

create function public.delete_saved_note_by_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  n integer;
begin
  delete from public.saved_messages
  where owner_id = caller and client_id = p_client_id and source_type = 'note';
  get diagnostics n = row_count;

  return n;
end;
$$;

revoke execute on function public.delete_saved_note_by_client(uuid) from public, anon;
grant execute on function public.delete_saved_note_by_client(uuid) to authenticated;

create or replace function public.edit_saved_note(p_saved uuid, p_text text, p_keep uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.saved_caller();
  s public.saved_messages;
  clean text := nullif(btrim(coalesce(p_text, '')), '');
  keep uuid[];
  left_files int;
begin
  perform public.saved_owned(caller, array[p_saved]);

  select * into s from public.saved_messages where id = p_saved for update;

  if s.source_type <> 'note' then
    raise exception 'saved copies are not editable' using errcode = '42501';
  end if;

  -- Не сказано, что оставить, — остаётся всё, как было.
  keep := coalesce(p_keep, array(
    select a.id from public.saved_message_attachments a where a.saved_id = p_saved order by a.position
  ));

  if cardinality(array(select distinct k from unnest(keep) k)) <> cardinality(keep)
    or exists (select 1 from unnest(keep) k where k is null)
  then
    raise exception 'attachments repeat' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(keep) k
    where not exists (select 1 from public.saved_message_attachments a where a.id = k and a.saved_id = p_saved)
  ) then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;

  delete from public.saved_message_attachments
  where saved_id = p_saved and not (id = any (keep));

  -- Оставленные — подряд, в новом порядке. Через сдвиг: уникальная позиция
  -- проверяется построчно.
  update public.saved_message_attachments set position = position + 1000
  where saved_id = p_saved;
  update public.saved_message_attachments a set position = (k.ord - 1)::int
  from unnest(keep) with ordinality as k(id, ord)
  where a.id = k.id;

  select count(*) into left_files from public.saved_message_attachments where saved_id = p_saved;

  update public.saved_messages set
    text = case when kind in ('voice', 'video_note') then null else clean end,
    kind = case when kind = 'media' and left_files = 0 then 'text' else kind end,
    edited_at = now()
  where id = p_saved;

  perform public.check_saved_note_shape(p_saved);
end;
$$;
