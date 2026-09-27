-- `attachments_voice_is_audio` пропускал голосовое без mime или без длительности:
-- CHECK с NULL внутри даёт NULL, а NULL для CHECK — «не нарушено». Пустые
-- значения теперь явно считаются нарушением.
alter table public.attachments
  drop constraint attachments_voice_is_audio,
  add constraint attachments_voice_is_audio check (
    message_kind <> 'voice'
    or (
      mime_type is not null
      and mime_type like 'audio/%'
      and duration_ms is not null
      and duration_ms > 0
    )
  );
