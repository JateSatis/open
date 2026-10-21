import { BirthDateInFutureError, BirthDateTooYoungError } from '@/api/privacy';

/** Текст ошибки даты для человека; сырой ответ сервера наружу не идёт. */
export function describeBirthDateError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof BirthDateTooYoungError) return 'Регистрация в Open возможна с 13 лет.';
  if (error instanceof BirthDateInFutureError) return 'Дата рождения не может быть в будущем.';

  return 'Не удалось сохранить дату. Проверьте интернет и попробуйте ещё раз.';
}
