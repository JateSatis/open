-- Сохранённые, фильтры: `saved_matches` встраивается в запрос.
--
-- Функция с `set search_path` не встраивается: условие считалось вызовом на
-- каждую запись владельца, и индексы поиска (`saved_messages_search_*`) не
-- работали. Без него все имена — полные, а встроенное условие планировщик
-- видит целиком.

create or replace function public.saved_matches(s public.saved_messages, f public.saved_filter)
returns boolean
language sql
stable
as $$
  select
    (f.categories is null or s.source_category = any (f.categories))
    and (f.from_at is null or s.created_at >= f.from_at)
    and (f.to_at is null or s.created_at < f.to_at)
    and (f.types is null or public.saved_type(s.kind, s.text, s.pop_id) = any (f.types))
    and (f.tags is null or exists (
      select 1 from public.saved_message_tags t
      where t.saved_id = s.id and t.tag_id = any (f.tags)
    ))
    and (not coalesce(f.searching, false) or (
      (s.text is not null and (
        (f.tsq is not null and public.search_tsv(s.text) operator(pg_catalog.@@) f.tsq)
        or (f.pattern is not null and public.search_norm(s.text) like f.pattern)
      ))
      or exists (
        select 1 from public.saved_message_attachments a
        where a.saved_id = s.id and a.pop_title is not null and (
          (f.tsq is not null and public.search_tsv(a.pop_title) operator(pg_catalog.@@) f.tsq)
          or (f.pattern is not null and public.search_norm(a.pop_title) like f.pattern)
        )
      )
    ))
$$;

revoke execute on function public.saved_matches(public.saved_messages, public.saved_filter) from public, anon, authenticated;
