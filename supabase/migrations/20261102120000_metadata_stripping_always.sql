-- Приватность, этап 5: очистка метаданных — правило для всех, а не
-- настройка. Каждый загружаемый файл чистит `sanitize-media`
-- (20261102100000_media_sanitized_objects.sql), поэтому переключатель
-- `uploaded_media_metadata_stripping` больше ничего не значит.

alter table public.privacy_settings drop column uploaded_media_metadata_stripping;

create or replace function public.privacy_default_settings(p_minor boolean)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_minor then jsonb_build_object(
    'profile_identity_masking', 'friends',
    'dialogue_participant_name_masking', 'friends',
    'activity_status_visibility', 'friends',
    'avatar_visibility', 'friends',
    'message_activity_metadata_visibility', 'friends',
    'account_search_visibility', 'friends',
    'dialogue_media_visibility', 'friends',
    'friends_list_visibility', 'nobody',
    'dialogue_hidden_text_visibility', 'enabled',
    'public_message_visibility_delay', 'random_delay'
  ) else jsonb_build_object(
    'profile_identity_masking', 'everyone',
    'dialogue_participant_name_masking', 'everyone',
    'activity_status_visibility', 'everyone',
    'avatar_visibility', 'everyone',
    'message_activity_metadata_visibility', 'everyone',
    'account_search_visibility', 'everyone',
    'dialogue_media_visibility', 'everyone',
    'friends_list_visibility', 'everyone',
    'dialogue_hidden_text_visibility', 'disabled',
    'public_message_visibility_delay', 'off'
  ) end
$$;
