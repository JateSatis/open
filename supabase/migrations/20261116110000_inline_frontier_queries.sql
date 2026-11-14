-- Both helpers are private (no EXECUTE for API roles). Their callers already
-- run with the definer's fixed public search_path. Allow PostgreSQL to inline
-- the SQL so EXISTS/first unread/count limits can reach the history indexes.
alter function public.readable_occurrences(uuid,bigint,integer,bigint) security invoker;
alter function public.readable_occurrences(uuid,bigint,integer,bigint) reset all;
alter function public.unread_occurrences(uuid,bigint,integer,boolean) reset all;
