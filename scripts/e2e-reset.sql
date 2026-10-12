-- Уборка данных, которые оставляют прерванные сценарии Maestro: сценарий убирает за собой в
-- конце, а оборванный посередине (выключили ноутбук, упал шаг) — нет, и следующий прогон
-- падает уже на этих данных. Запускается обёрткой перед прогоном:
--   npx supabase db query --linked -f scripts/e2e-reset.sql
--
-- Удаление идёт от имени автора через те же функции, что и в приложении: счётчики, превью
-- чата, закрепы и сигналы обновляются как при обычном удалении. Файл — одна транзакция.
do $$
declare
  job record;
  test_users uuid[] := array(
    select id from public.profiles where username in ('shy_guy', 'jatesatis', 'tanya_bomba')
  );
  messages_jobs jsonb;
  comment_jobs jsonb;
  reaction_jobs jsonb;
begin
  -- Список работы собираем до смены роли: дальше запросы идут уже под RLS.
  select coalesce(jsonb_agg(jsonb_build_object('author', author_id, 'ids', ids)), '[]')
    into messages_jobs
    from (
      select author_id, array_agg(id) as ids
        from public.messages
       where text like 'maestro-%' and deleted_at is null and author_id = any (test_users)
       group by author_id
    ) m;

  select coalesce(jsonb_agg(jsonb_build_object('author', author_id, 'id', id)), '[]')
    into comment_jobs
    from public.comments
   where text like 'maestro-%' and deleted_at is null and author_id = any (test_users);

  -- pop-viewer ставит и снимает ❤️ и 🔥 на попе Test Kanal; остальные реакции — живые.
  select coalesce(jsonb_agg(jsonb_build_object('author', r.user_id, 'id', r.target_id)), '[]')
    into reaction_jobs
    from public.reactions r
    join public.pops p on p.id = r.target_id
    join public.channels c on c.id = p.channel_id
   where r.target_type = 'pop'
     and r.deleted_at is null
     and r.emoji in ('❤️', '🔥')
     and c.title = 'Test Kanal'
     and r.user_id = any (test_users);

  perform set_config('role', 'authenticated', true);

  for job in select * from jsonb_array_elements(messages_jobs) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', job.value->>'author', 'role', 'authenticated')::text, true);
    perform public.delete_messages(array(select jsonb_array_elements_text(job.value->'ids'))::uuid[]);
  end loop;

  for job in select * from jsonb_array_elements(comment_jobs) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', job.value->>'author', 'role', 'authenticated')::text, true);
    perform public.delete_comment((job.value->>'id')::uuid);
  end loop;

  for job in select * from jsonb_array_elements(reaction_jobs) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', job.value->>'author', 'role', 'authenticated')::text, true);
    perform public.set_reaction('pop', (job.value->>'id')::uuid, null);
  end loop;

  raise notice 'e2e-reset: messages %, comments %, pop reactions %',
    (select coalesce(sum(jsonb_array_length(value->'ids')), 0) from jsonb_array_elements(messages_jobs)),
    jsonb_array_length(comment_jobs),
    jsonb_array_length(reaction_jobs);
end
$$;

reset role;

-- Итог одной строкой: обёртка печатает его в отчёт прогона (видно только последний SELECT).
select
  (select count(*) from public.messages where text like 'maestro-%' and deleted_at is null) as messages_left,
  (select count(*) from public.comments where text like 'maestro-%' and deleted_at is null) as comments_left;
