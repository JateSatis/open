-- A short catch-up after a long history usually has fewer new transactions
-- than loaded entities. Support that join order as well as per-message seeks.
create index history_events_writer_message on history_sync.events(writer,message_id);
