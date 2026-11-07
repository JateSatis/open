-- Первичная инициализация расширений и ролей для облегчённого стека Open.
-- Образ `supabase/postgres:17` уже содержит базовые роли и схемы, а этот
-- скрипт гарантирует наличие всех расширений, которые требуют 69 миграций
-- проекта (`pg_cron`, `pgmq`, `pg_net`, `pg_trgm`, `unaccent`, `supabase_vault`),
-- и выставляет пароли служебным ролям из переменной окружения.

\set pgpass `echo "$POSTGRES_PASSWORD"`

alter role supabase_admin with password :'pgpass';
alter role supabase_auth_admin with password :'pgpass';
alter role supabase_storage_admin with password :'pgpass';
alter role authenticator with password :'pgpass';
alter role postgres with password :'pgpass';

create schema if not exists extensions;
create schema if not exists _realtime;

create extension if not exists pg_cron;
create extension if not exists pgmq;
create extension if not exists pg_net;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists supabase_vault;
