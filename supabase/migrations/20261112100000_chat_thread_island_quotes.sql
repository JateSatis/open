-- Цитата оригинала островка сохраняет путь и в своём исходном чате.
-- Старые функции принимают только id и выбирают прямое сообщение раньше
-- островка. Новый вызов сохраняет явный via, не обходя проверки отправки,
-- RLS, check_reply_quote и транзакционность цитат.
create function public.send_chat_thread_message(
  p_chat uuid,
  p_reply_to uuid[],
  p_reply_via jsonb,
  p_text text default null,
  p_media jsonb default null,
  p_voice jsonb default null,
  p_hidden jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
begin
  if cardinality(p_reply_to) > 100
    or cardinality(p_reply_to) <> cardinality(array(select distinct unnest(p_reply_to))) then
    raise exception 'invalid reply quotes' using errcode = '22023';
  end if;
  if p_reply_via is null or jsonb_typeof(p_reply_via) <> 'object' then
    raise exception 'invalid quote paths' using errcode = '22023';
  end if;
  if p_voice is not null then
    new_id := public.send_voice_message(p_chat, p_voice, null);
  else
    new_id := public.send_media_message(p_chat, p_text, p_media, null, p_hidden);
  end if;

  insert into public.message_replies (chat_id, message_id, quoted_id, position, quoted_forward_id)
  select p_chat, new_id, q.id, (q.ord - 1)::int,
    case
      when p_reply_via ? q.id::text then (p_reply_via ->> q.id::text)::uuid
      when exists (select 1 from public.messages m where m.id = q.id and m.chat_id = p_chat) then null
      else public.forward_holding(q.id, p_chat)
    end
  from unnest(p_reply_to) with ordinality q(id, ord);

  return new_id;
end;
$$;

revoke execute on function public.send_chat_thread_message(uuid, uuid[], jsonb, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.send_chat_thread_message(uuid, uuid[], jsonb, text, jsonb, jsonb, jsonb) to authenticated;

-- При переключении с ответа на удалённое исходное нужен номер заглушки.
-- Корни можно узнать только у видимого ответа; чат корней совпадает с ним.
create function public.chat_thread_root_positions(p_reply uuid)
returns table (id uuid, seq bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.seq
  from public.message_rows reply
  join public.messages r on r.id = any(reply.chat_thread_root_ids) and r.chat_id = reply.chat_id
  where reply.id = p_reply
  order by r.seq desc
$$;

revoke execute on function public.chat_thread_root_positions(uuid) from public, anon;
grant execute on function public.chat_thread_root_positions(uuid) to authenticated;
