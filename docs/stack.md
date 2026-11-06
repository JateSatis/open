# Стек и архитектурные решения

Читай по необходимости: зависимости, медиа/CDN, состояние, ранжирование, хранилище.

**Клиент:** Expo (React Native), managed workflow, **dev build** (не Expo Go); TypeScript strict;
Expo Router; Expo UI.

**Бэкенд:** Supabase (Postgres, auth, Realtime, Storage, Edge Functions); LiveKit Cloud (SFU);
Expo Push (FCM/APNs). Отдельного API-сервера нет — клиент ходит в Postgres напрямую, безопасность
через RLS; секреты/права выше пользовательских — в Edge Functions.

Решения архитектурной сессии:
- серверные данные (чаты, сообщения, лента, профили) — **TanStack Query**; чисто клиентское (UI,
  черновики, открытый чат) — **Zustand**; зоны не смешивать (серверное не дублировать в Zustand).
- медиа — **Supabase Storage**: клиент пишет во временный закрытый `uploads` (`{id}/…`),
  `sanitize-media` кладёт чистый файл на постоянное место и отмечает в `media_objects`. Бакеты:
  `avatars` (фото людей, `avatar_object_readable`), `chat-media` (медиа сообщений/комментариев,
  `chat_media_object_readable`), публичный `media` (попсы, фото групп/каналов). Закрытые бакеты
  подписываются пачкой и кешируются по пути (`src/api/signedUrls.ts`: avatars — час, chatMedia —
  15 мин; `expo-image` cacheKey по пути, голосовые — файл в кеше). Миграция на CDN (R2 и т.п.) —
  когда трафик перестанет лезть в free-тариф; закрытые бакеты — CDN с подписью на краю, не
  публичные адреса; абстракция в `src/api/` и `src/features/media/storage.ts` готова к замене с
  первого дня.
- ранжирование ленты — **простой SQL-скоринг** (`engagement / age^gravity`) над `feed_items`;
  внешний recsys-движок — не раньше появления данных.

Новая зависимость — без спроса, но не бездумно: пакеты Expo SDK → популярное/живое → остальное.
Нативный пакет = пересборка dev build (нормально, сказать человеку).
