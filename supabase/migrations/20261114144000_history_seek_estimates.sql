-- Fresh chat IDs are frequently absent from the column statistics. With an
-- ID-specific row estimate of one, the planner considered it cheap to run
-- viewer functions and then sort 1,101 messages for a 30-item page (or a
-- one-item boundary probe). Use the average-chat estimate only in the
-- directional reader, whose SQL already fixes the index order explicitly.
-- The envelope, content lookups, connection settings and grants are unchanged.
alter function public.history_element_slice(uuid,bigint,integer,text,integer,boolean,boolean)
  set plan_cache_mode = force_generic_plan;
