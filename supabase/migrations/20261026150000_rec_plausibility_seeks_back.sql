-- Рекомендации, этап 1: правдоподобие снимка показа учитывает перемотки назад.
--
-- Дважды перемотал пятисекундный поп к началу — смотрел 15 с без единого
-- круга. Прежнее правило (просмотр не дольше длины × (круги + 1)) отклоняло
-- такой честный показ; теперь каждая перемотка назад добавляет к допуску ещё
-- одну длину. Реальное время показа по-прежнему ограничивает всё сверху.

-- Та же функция, что в 20261026110000_rec_journal_ingest.sql, плюс
-- перемотки назад в допуске.
/**
 * Снимок показа правдоподобен: просмотр не дольше реального времени показа и
 * длины попа × (круги + перемотки назад + 1), позиции — в пределах длины, карта покрытия — в
 * пределах сегментов. `elapsed_ms` — время от начала показа до снимка.
 */
create or replace function public.rec_snapshot_plausible(snap jsonb, elapsed_ms numeric, duration_ms int, cfg jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  tol numeric := coalesce((cfg ->> 'plausibilityToleranceMs')::numeric, 1500)
    + coalesce((cfg ->> 'plausibilityToleranceShare')::numeric, 0.05) * greatest(elapsed_ms, 0);
  dur numeric := greatest(coalesce(duration_ms, 0), 1);
  watch numeric := public.rec_num(snap, 'watch_ms');
  visible numeric := public.rec_num(snap, 'visible_ms');
  loops numeric := coalesce(public.rec_num(snap, 'loops'), 0);
  seeks_back numeric := coalesce(public.rec_num(snap, 'seeks_back'), 0);
  max_pos numeric := coalesce(public.rec_num(snap, 'max_pos_ms'), 0);
  coverage numeric := coalesce(public.rec_num(snap, 'coverage'), 0);
  item jsonb;
begin
  if watch is null or visible is null or watch < 0 or visible < 0 or loops < 0 or seeks_back < 0 or max_pos < 0 then
    return false;
  end if;

  if watch > elapsed_ms + tol or visible > elapsed_ms + tol then
    return false;
  end if;

  -- Перемотка назад — честный повторный просмотр без круга.
  if watch > dur * (loops + seeks_back + 1) + tol then
    return false;
  end if;

  if max_pos > dur + tol then
    return false;
  end if;

  if coverage < 0 or coverage <> trunc(coverage) or coverage >= power(2::numeric, public.rec_segments(duration_ms)) then
    return false;
  end if;

  if jsonb_typeof(snap -> 'seeks') = 'array' then
    for item in select value from jsonb_array_elements(snap -> 'seeks') loop
      if coalesce(public.rec_num(item, 'from'), -1) < 0 or coalesce(public.rec_num(item, 'from'), 0) > dur + tol
         or coalesce(public.rec_num(item, 'to'), -1) < 0 or coalesce(public.rec_num(item, 'to'), 0) > dur + tol then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke execute on function public.rec_snapshot_plausible(jsonb, numeric, int, jsonb) from public, anon, authenticated;
