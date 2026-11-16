# Общие слои и зависимости

Читай для сквозного изменения. Сверено с `b123c6b`, 08.11.2026.
Меняешь хранение состояния — [решения о состоянии](../stack.md#состояние);
добавляешь пакет — [выбор зависимостей](../stack.md#выбор-зависимостей).

## Путь выполнения

`src/app` (Expo Router) → `src/features/<область>` → `src/api` → Supabase PostgREST/RPC.
Realtime возвращает сигналы в доменные хуки и кеш; медиа и звонки дополнительно идут через
[Edge Functions](data.md). Права определяются сервером, не состоянием кнопок.

<!-- prettier-ignore -->
| Связь | Точка входа и зачем читать |
| --- | --- |
| Корень приложения | [app/_layout](../../src/app/_layout.tsx) создаёт [QueryClient](../../src/lib/queryClient.ts) на время жизни аккаунта, подключает провайдеры жестов/клавиатуры, связь, звонки и глобальные оверлеи |
| Маршруты и вкладки | [app](../../src/app/), [TabBar](../../src/components/TabBar/index.tsx), [SlidePage](../../src/components/SlidePage/index.tsx): экран может иметь несколько точек входа |
| Серверное состояние | TanStack Query; ключи и слияние данных обычно внутри фичи (`keys.ts`, `*Cache.ts`). Например, [historyCache](../../src/features/chats/messages/historyCache.ts) |
| Локальное состояние | Zustand: [store](../../src/store/) и доменные `*Store.ts`/`*store.ts`. Только чтение `src/store` не даёт карту всех состояний |
| Сессия и сброс кешей | [useSession](../../src/features/auth/useSession.ts), [resetClientState](../../src/features/auth/resetClientState.ts): учитывать при выходе/смене аккаунта |
| Сеть и таймаут | [supabase](../../src/api/supabase.ts), [requestDeadline](../../src/api/requestDeadline.ts). [ConnectionWatcher](../../src/features/connection/ConnectionWatcher/index.tsx) подключает [синхронизацию TanStack Query](../../src/features/connection/syncQueryOnlineState.ts) со статусом из [connectionStore](../../src/features/connection/connectionStore.ts) |
| Входящие события | [useInAppAlerts](../../src/features/notifications/useInAppAlerts.ts) использует пользовательские события из [chats API](../../src/api/chats.ts); это не отдельный универсальный push-клиент |
| Внешний вид | [theme](../../src/theme/), [общие компоненты](../../src/components/), [hooks](../../src/hooks/). Эталон конкретного шита/жеста ищи в соответствующей фиче |

## Пакеты и нативные связи

Версии и команды бери из [package.json](../../package.json), точные разрешённые версии — из
[package-lock.json](../../package-lock.json). Читай нужную запись, не весь lock-файл.

<!-- prettier-ignore -->
| За что отвечает | Где проверять влияние |
| --- | --- |
| Expo Router, screens, safe-area | `src/app`, SlidePage, корневой layout |
| Reanimated, Gesture Handler, keyboard-controller | Шиты, просмотрщик, композер; жесты и клавиатура требуют целевого прохода на устройстве |
| expo-image/video/audio/media-library, compressor, Skia | [Медиа](media.md), редактор попа; конкретные импорты покажут используемый пакет |
| Supabase, TanStack Query, Zustand | API, доменные ключи/кеши/сторы; изменение ключа может затронуть Realtime и оптимистичные обновления |
| LiveKit и WebRTC | [streams](../../src/features/streams/), [livekitGlobals](../../src/features/streams/livekitGlobals.ts), настройки плагинов |
| Собственные модули | [modules](../../modules/): `audio-output`, `back-gesture`, `call-service`, `scroll-tap`, `text-geometry`; потребителей ищи по имени модуля |

Нативную совместимость проверяй по [app.json](../../app.json), [eas.json](../../eas.json),
[patches](../../patches/) и `modules/*/expo-module.config.json`; критерии пересборки —
в разделе [окружение и сборки](../development.md#окружение-и-сборки).

Импорты не показывают все связи: проверь query keys, события Realtime, параметры маршрутов,
RPC и имена нативных модулей. Полный тестовый набор выбирается по правилам процесса;
эта карточка не добавляет автоматический запуск устройств, сборок или ревьюеров.
