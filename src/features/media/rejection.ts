import { VideoPrepareError } from './lib/compressVideo';
import { MediaUploadError } from './storage';

/** База не приняла файл: он не прошёл очистку (`media_objects`). */
export const MEDIA_NOT_SANITIZED_CODE = 'OPN14';

/**
 * Отказ с файлом, который повтор сам не исправит, — человеческим текстом.
 * null — не про файл (или обрыв связи, который виден и так).
 */
export function mediaRejectionText(cause: unknown): string | null {
  if (cause instanceof VideoPrepareError) {
    return 'Не удалось подготовить видео к отправке. Попробуйте другое.';
  }

  if (cause instanceof MediaUploadError && cause.reason === 'unsupported') {
    return 'Файл не отправлен: из него не удалось убрать геометку и данные камеры. Попробуйте другой.';
  }

  const code =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : null;

  if (code === MEDIA_NOT_SANITIZED_CODE) {
    return 'Файл не прошёл проверку перед отправкой. Выберите его заново.';
  }

  return null;
}
