-- Страницы ранга снова отдают и закреплённый комментарий.
--
-- В 20261012100000_comment_pins_and_pop_forwards.sql закреплённый исключался
-- из страниц, а клиент читал закреп отдельным запросом. Два запроса — два
-- снимка: смена закрепа между ними роняла прежний закреплённый из списка
-- совсем (его нет ни в странице, ни в закрепе). Теперь страница — по рангу
-- целиком, а дубль закреплённого клиент убирает сам: он знает закреп и не
-- может потерять строку. Тело — то же, что в 20261011100000_pop_comments.sql.

create or replace function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30
)
returns setof public.comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.comments;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  for c in
    select *
    from public.comments
    where target_id = target
      and thread_root_id is null
      and (deleted_at is null or replies_count > 0)
      and (after_rank is null or (rank, id) < (after_rank, after_id))
    order by rank desc, id desc
    limit least(greatest(coalesce(page_size, 30), 1), 100)
  loop
    if c.deleted_at is not null then
      c.author_id := null;
      c.text := null;
      c.edited_at := null;
      c.member_reactions := '{}'::jsonb;
      c.visitor_reactions := '{}'::jsonb;
      c.reactions_count := 0;
    end if;

    return next c;
  end loop;
end;
$$;
