# Стек и архитектурные решения

Справочник архитектурных решений. Точки входа в код — [архитектурная карта](map/architecture.md).
Читай выбранный раздел; оглавление: `node .agents/scripts/read-doc.mjs docs/stack.md`.

## Клиент

**Клиент:** Expo (React Native), managed workflow, **dev build** (не Expo Go); TypeScript strict;
Expo Router; Expo UI.

## Инфраструктура

**Бэкенд:** self-hosted Supabase-стек на VPS в РФ (Postgres 17, Auth, PostgREST, Realtime,
Storage, Edge Functions, Vault и `pg_cron`) плюс собственный LiveKit Server и TURN; Expo Push
(FCM/APNs). Стек и Caddy-маршрутизация описаны в `infra/`. Отдельного API-сервера нет — клиент
ходит в PostgREST напрямую, безопасность через RLS; секреты и действия с повышенными правами
остаются в Edge Functions.

Схему выкатывают из миграций командой `npm run selfhost:migrate`, SQL-тесты гоняют через
`npm run selfhost:test`. Функции и LiveKit обновляют на VPS из `infra/` через Docker Compose;
детали, Vault-конфигурация и генерация `src/api/types.gen.ts` через SSH-туннель описаны в
[миграциях и окружении](backend.md#миграции-типы-переменные-окружения). Локальные клиентские URL и anon key берутся из `infra/.env` в `.env`;
после смены конфигурации Metro запускается с `--clear`.

## Состояние

- серверные данные (чаты, сообщения, лента, профили) — **TanStack Query**; чисто клиентское (UI,
  черновики, открытый чат) — **Zustand**; зоны не смешивать (серверное не дублировать в Zustand).

## Медиа и CDN

- медиа — **Supabase Storage**: клиент пишет во временный закрытый `uploads` (`{id}/…`),
  `sanitize-media` кладёт чистый файл на постоянное место и отмечает в `media_objects`. Бакеты:
  `avatars` (фото людей, `avatar_object_readable`), `chat-media` (медиа сообщений/комментариев,
  `chat_media_object_readable`), публичный `media` (попсы, фото групп/каналов). Закрытые бакеты
  подписываются пачкой и кешируются по пути (`src/api/signedUrls.ts`: avatars — час, chatMedia —
  15 мин; `expo-image` cacheKey по пути, голосовые — файл в кеше). Миграция на CDN (R2 и т.п.) —
  когда трафик перестанет лезть в free-тариф; закрытые бакеты — CDN с подписью на краю, не
  публичные адреса; абстракция в `src/api/` и `src/features/media/storage.ts` готова к замене с
  первого дня.

## План ленты

- план ранжирования ленты — **простой SQL-скоринг** (`engagement / age^gravity`) над `feed_items`;
  внешний recsys-движок — не раньше появления данных. Основная лента в приложении пока не
  реализована; рабочие поиск и журнал событий не означают готовое ранжирование (см. [карту](map.md)).

## Выбор зависимостей

Новая зависимость — без спроса, но не бездумно: пакеты Expo SDK → популярное/живое → остальное.
Нативный пакет = пересборка dev build (нормально, сказать человеку).
