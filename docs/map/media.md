# Выбор, загрузка и просмотр медиа

Слова: галерея, шит медиа, предпросмотр, полёт фото, вложение, голосовое, кружок, аватар.
Сверено с `b123c6b`, 08.11.2026. Выбор медиа находится в `features/chats`, общие механизмы — в `features/media`.

## Точки входа

<!-- prettier-ignore -->
| Сценарий | Читать по ходу данных |
| --- | --- |
| Открытие шита, жест и раскладка | [MediaPickerSheet](../../src/features/chats/MediaPickerSheet/index.tsx), [SheetShell](../../src/features/chats/MediaPickerSheet/SheetShell.tsx), [geometry](../../src/features/chats/MediaPickerSheet/geometry.ts) |
| Получение/прогрев галереи | [useGalleryAssets](../../src/features/media/useGalleryAssets.ts), [galleryPrefetch](../../src/features/media/galleryPrefetch.ts) |
| Предпросмотр и переход к просмотру | [MediaPreview](../../src/features/media/MediaPreview/), [MediaViewer](../../src/features/media/MediaViewer/index.tsx), [useViewerFlight](../../src/features/media/MediaViewer/useViewerFlight.ts), [tileRegistry](../../src/features/media/tileRegistry.ts) |
| Загрузка и очистка файла | [uploadAll](../../src/features/media/uploadAll.ts) → [storage](../../src/features/media/storage.ts) → [sanitize-media](../../supabase/functions/sanitize-media/handler.ts) |
| Показ закрытого файла/аватара | [chatMedia](../../src/api/chatMedia.ts), [avatars](../../src/api/avatars.ts) → [signedUrls](../../src/api/signedUrls.ts); UI использует [use-media-source](../../src/hooks/use-media-source.ts), [use-avatar-source](../../src/hooks/use-avatar-source.ts) |
| Голосовое/кружок | [RecordingBar](../../src/features/media/RecordingBar/), [VoicePlayer](../../src/features/media/VoicePlayer/), [VideoNoteRecorder](../../src/features/media/VideoNoteRecorder/), [VideoNotePlayer](../../src/features/media/VideoNotePlayer/) |

## Связи и границы

- Шит использует `Modal`, Reanimated и жесты. Координаты для перехода к просмотру зависят
  от окна и геометрии исходной плитки; изучай `useViewerFlight`/`tileRegistry`, если сломан «полёт».
- `storage.uploadMedia` возвращает метаданные файла, но не вставляет сообщение/вложение в БД.
  Отправку и перенос из исходящих ведёт [delivery](../../src/features/chats/messages/delivery.ts);
  для попа есть [uploadPop](../../src/features/pops/uploadPop.ts), для комментария — свой delivery.
- Меняешь загрузку/публикацию — [очистка медиа](../product.md#контент-и-медиа);
  подписи/кеш — [медиа и CDN](../stack.md#медиа-и-cdn); доступ — [данные](data.md).
  Для изменения жеста или геометрии шита эти разделы сами по себе не нужны.
- Подписанная ссылка меняется со временем; путь объекта и кеш изображения — отдельные понятия.
  При изменении подписей проверь использование ключа кеша, обновление URL и недоступный объект.
- Фото, видео, голосовое и аватар имеют разные потребители. Меняешь общий `storage`/подписи —
  найди затронутые вызовы; правка одного шита не требует полного обхода всех медиа-сценариев.

## Проверить изменение

[MediaPickerSheet.test](../../src/features/chats/MediaPickerSheet/MediaPickerSheet.test.tsx),
[useGalleryAssets.test](../../src/features/media/useGalleryAssets.test.ts),
[storage.test](../../src/features/media/storage.test.ts), [avatars.test](../../src/api/avatars.test.ts),
[sanitize-media handler.test](../../supabase/functions/sanitize-media/handler.test.ts),
[privacy_media_access.sql](../../supabase/tests/privacy_media_access.sql) — по затронутому пути.

Задержки и переходы: [perf](../../src/features/media/perf.ts), флаги `MEDIA_PERF`/`NAVIGATION_PERF`
по умолчанию выключены. Для сравнения фиксируй кеш, сеть, устройство и сборку; запись экрана
может влиять на сценарий. При похожем переходе доступен [кейс media-sheet](../../.agents/skills/optimize/references/media-sheet-case.md).
Инструменты выбираются по `$optimize`/`device`; чужой кейс не задаёт норматив всем экранам.
