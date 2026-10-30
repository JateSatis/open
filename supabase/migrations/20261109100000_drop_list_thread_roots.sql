-- Слово «тред» скоро будет значить и тред чата. Старая обёртка
-- `list_thread_roots` над `list_comment_thread_roots` клиентом не вызывается и
-- других функций не держит — убираем, чтобы в схеме не было голого «thread».
drop function public.list_thread_roots(uuid, double precision, uuid, integer);
