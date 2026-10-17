-- Лидер кластера: эмодзи, которой красится его подсветка в режиме
-- фрагментов. Одинаков у всех людей и не скачет при ничьей, поэтому живёт
-- на сервере, а не считается каждым клиентом заново.
--
-- Правило (то же в `src/features/chats/fragments/reactionStyle.ts`):
-- ряды участников и посетителей складываются; лидер — эмодзи с наибольшим
-- числом. Прежний лидер среди максимальных — остаётся, пока соперник не
-- обгонит строго. Иначе — первый из максимальных по `reaction_emojis.position`
-- (одно место правды порядка и для базы, и для клиента: клиентский список
-- идёт в том же порядке, его сверяет тест). Реакций нет — null.
--
-- Пересчёт лидера — триггером на смену рядов, а не в каждом месте
-- обновления. Пересчёт модели (`fragment_clusters_apply`) собирает ряды
-- одним `refresh_message_clusters` под флагом писателя — пошаговые счётчики
-- в нём молчат, — поэтому кластер с наследованным id сравнивается со своим
-- лидером до пересчёта, а новый (вставлен с пустыми рядами) считается с нуля.
--
-- Сигнал `clusters_changed` в топик чата — когда у показанного кластера
-- сменился лидер или число реакций: экран в режиме фрагментов перечитывает
-- кластеры и перекрашивает подсветку. Пересчёт модели сигналит сам.

alter table public.fragment_clusters
  add column dominant_emoji text references public.reaction_emojis (emoji);

comment on column public.fragment_clusters.dominant_emoji is
  'Лидер реакций кластера — цвет подсветки. Ставит только триггер; null — реакций нет.';

/** Лидер сводных рядов кластера; `previous` держится в ничьей. */
create function public.cluster_dominant_reaction(member jsonb, visitor jsonb, previous text)
returns text
language sql
stable
set search_path = public
as $$
  with totals as (
    select key, sum(value::int) as total
    from (
      select key, value from jsonb_each_text(coalesce(member, '{}'::jsonb))
      union all
      select key, value from jsonb_each_text(coalesce(visitor, '{}'::jsonb))
    ) parts
    group by key
    having sum(value::int) > 0
  ),
  leaders as (
    select t.key, e.position
    from totals t
    left join public.reaction_emojis e on e.emoji = t.key
    where t.total = (select max(total) from totals)
  )
  select case
    when exists (select 1 from leaders l where l.key = previous) then previous
    else (select l.key from leaders l order by l.position nulls last, l.key limit 1)
  end
$$;

create function public.set_cluster_dominant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.dominant_emoji := public.cluster_dominant_reaction(
    new.member_reactions,
    new.visitor_reactions,
    case when tg_op = 'UPDATE' then old.dominant_emoji end
  );

  return new;
end;
$$;

revoke execute on function public.set_cluster_dominant() from public, anon, authenticated;

create trigger set_cluster_dominant
  before insert or update of member_reactions, visitor_reactions, dominant_emoji
  on public.fragment_clusters
  for each row execute function public.set_cluster_dominant();

create function public.signal_cluster_look()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fragment_clusters_writing()
     or new.deleted_at is not null
     or new.display_start is null
     or (old.dominant_emoji, old.reactions_count) is not distinct from (new.dominant_emoji, new.reactions_count) then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
      'clusters_changed',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.signal_cluster_look() from public, anon, authenticated;

create trigger on_cluster_look_changed
  after update on public.fragment_clusters
  for each row execute function public.signal_cluster_look();

-- Бэкфилл: прежнего лидера нет, ничья — по порядку справочника.
update public.fragment_clusters
set member_reactions = member_reactions
where member_reactions <> '{}'::jsonb or visitor_reactions <> '{}'::jsonb;

-- Та же функция, что в 20261024100000_fragment_cluster_decisions.sql, плюс
-- `dominant_emoji`.
drop function public.list_message_clusters(uuid);

create function public.list_message_clusters(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  start_offset int,
  end_offset int,
  display_start int,
  display_end int,
  display_text text,
  popularity double precision,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count int,
  comments_count int,
  people_count int,
  fragments_count int,
  my_emoji text,
  my_fragment_id uuid,
  decision_id uuid,
  dominant_emoji text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    k.id, k.message_id, k.start_offset, k.end_offset, k.display_start, k.display_end,
    substr(m.text, k.display_start + 1, k.display_end - k.display_start),
    k.popularity, k.member_reactions, k.visitor_reactions, k.reactions_count, k.comments_count,
    k.people_count,
    (
      select count(*)::int from public.message_fragments f
      where f.cluster_id = k.id and f.deleted_at is null
    ),
    mine.emoji,
    mine.target_id,
    k.decision_id,
    k.dominant_emoji
  from public.fragment_clusters k
  join public.messages m on m.id = k.message_id
  left join lateral (
    select r.emoji, r.target_id
    from public.reactions r
    join public.message_fragments f on f.id = r.target_id
    where r.target_type = 'fragment'
      and r.user_id = auth.uid()
      and r.deleted_at is null
      and f.cluster_id = k.id
    order by r.updated_at desc
    limit 1
  ) mine on true
  where k.message_id = target_message
  order by k.display_start
$$;

revoke execute on function public.list_message_clusters(uuid) from public, anon;
grant execute on function public.list_message_clusters(uuid) to authenticated;
