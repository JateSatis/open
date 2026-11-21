# Общие слои и зависимости

Читай для сквозного изменения. Сверено с `b123c6b`, 08.11.2026.
Меняешь хранение состояния — [решения о состоянии](../stack.md#состояние);
добавляешь пакет — [выбор зависимостей](../stack.md#выбор-зависимостей).

## Путь выполнения

`src/index.tsx` → `src/navigation/routes` (React Navigation) → `src/features/<область>` → `src/api` → Supabase PostgREST/RPC.
Realtime возвращает сигналы в доменные хуки и кеш; медиа и звонки дополнительно идут через
[Edge Functions](data.md). Права определяются сервером, не состоянием кнопок.

<!-- prettier-ignore -->
| Связь | Точка входа и зачем читать |
| --- | --- |
| Корень приложения | [src/index.tsx](../../src/index.tsx) регистрирует приложение Expo, хранит ожидающую ссылку и подключает глобальные провайдеры, сервисы и оверлеи. Локальный ID из [useAuthBootstrap](../../src/features/auth/useSession.ts) задаёт владельца SQLite и [QueryClient](../../src/lib/queryClient.ts). [AppRoutes](../../src/navigation/routes/AppRoutes.tsx) выбирает первый экран по локальному аккаунту и дате рождения. Заставка уходит после layout активного экрана. |
| Маршруты и вкладки | [AppRoutes](../../src/navigation/routes/AppRoutes.tsx), [маршруты и ссылки](../../src/navigation/), [TabBar](../../src/components/TabBar/index.tsx), [SlidePage](../../src/components/SlidePage/index.tsx). Одну страницу регистрируем один раз, сколько бы точек входа у неё ни было. Исходная страница выбирает переход и передаёт параметры. Целевая страница читает параметры открытия из `route.params`. Дочерние компоненты получают данные и обработчики через `props`. |
| Серверное состояние | TanStack Query; ключи и слияние данных обычно внутри фичи (`keys.ts`, `*Cache.ts`). Например, [historyCache](../../src/features/chats/messages/historyCache.ts) |
| Локальное состояние | Zustand: [store](../../src/store/) и доменные `*Store.ts`/`*store.ts`. Только чтение `src/store` не даёт карту всех состояний |
| Сессия и сброс кешей | [useSession и useAuthBootstrap](../../src/features/auth/useSession.ts), [resetClientState](../../src/features/auth/resetClientState.ts): учитывать при выходе/смене аккаунта |
| Сеть и таймаут | [supabase](../../src/api/supabase.ts), [requestDeadline](../../src/api/requestDeadline.ts). [Наблюдатель приложения](../../src/features/connection/connectionMonitor.ts) обновляет [общий статус](../../src/features/connection/connectionStore.ts), [QueryClient аккаунта](../../src/lib/queryClient.ts) применяет его с учётом готовности сессии |
| Входящие события | [personalRealtimeEvents](../../src/features/notifications/personalRealtimeEvents.ts) подключает канал из [chats API](../../src/api/chats.ts) для подтверждённого аккаунта и его QueryClient. Карточки передаёт в [alertsStore](../../src/features/notifications/alertsStore.ts), звонки — в [incomingCall](../../src/features/streams/incomingCall.ts). |
| Внешний вид | [theme](../../src/theme/), [общие компоненты](../../src/components/), [hooks](../../src/hooks/). Эталон конкретного шита/жеста ищи в соответствующей фиче |

## Пакеты и нативные связи

Версии и команды бери из [package.json](../../package.json), точные разрешённые версии — из
[package-lock.json](../../package-lock.json). Читай нужную запись, не весь lock-файл.

<!-- prettier-ignore -->
| За что отвечает | Где проверять влияние |
| --- | --- |
| React Navigation, screens, safe-area | Корень приложения в `src/index.tsx`, AppRoutes, SlidePage |
| Reanimated, Gesture Handler, keyboard-controller | Шиты, просмотрщик, композер; жесты и клавиатура требуют целевого прохода на устройстве |
| expo-image/video/audio/media-library, compressor, Skia | [Медиа](media.md), редактор попа; конкретные импорты покажут используемый пакет |
| Supabase, TanStack Query, Zustand | API, доменные ключи/кеши/сторы; изменение ключа может затронуть Realtime и оптимистичные обновления |
| LiveKit и WebRTC | [streams](../../src/features/streams/), общая [подготовка SDK](../../src/features/streams/livekitGlobals.ts) из основных вкладок и при входе в звонок, настройки плагинов |
| Собственные модули | [modules](../../modules/): `audio-output`, `back-gesture`, `call-service`, `scroll-tap`, `text-geometry`; потребителей ищи по имени модуля |

Нативную совместимость проверяй по [app.json](../../app.json), [eas.json](../../eas.json),
[patches](../../patches/) и `modules/*/expo-module.config.json`; критерии пересборки —
в разделе [окружение и сборки](../development.md#окружение-и-сборки).

Импорты не показывают все связи: проверь query keys, события Realtime, параметры маршрутов,
RPC и имена нативных модулей. Полный тестовый набор выбирается по правилам процесса;
эта карточка не добавляет автоматический запуск устройств, сборок или ревьюеров.
