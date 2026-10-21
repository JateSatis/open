import { Platform } from 'react-native';

// Нативные выборы дат по-разному понимают «день». Material на Android берёт и
// отдаёт полночь UTC — ему день передаётся и читается в UTC. SwiftUI на iOS
// работает в местном поясе — ему местный полдень и местный календарь.
// Полдень — чтобы переход на летнее время не сдвинул день.

const ON_ANDROID = Platform.OS === 'android';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toPickerValue(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);

  return ON_ANDROID
    ? new Date(Date.UTC(year, month - 1, day, 12))
    : new Date(year, month - 1, day, 12);
}

export function fromPickerValue(date: Date): string {
  return ON_ANDROID
    ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** С чего открывается выбор, пока дату не указали: середина возрастов, без намёка. */
export function defaultPickerDate(now: Date = new Date()): string {
  return `${now.getFullYear() - 16}-01-01`;
}
