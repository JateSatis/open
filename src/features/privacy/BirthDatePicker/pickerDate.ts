import { Platform } from 'react-native';

// Нативные выборы дат по-разному понимают «день». Material на Android берёт и
// отдаёт полночь UTC, SwiftUI на iOS — момент в местном поясе. Полдень UTC —
// тот же календарный день для обоих почти в любом поясе; обратно день
// читается тем же календарём, которым его выбирали.

export function toPickerValue(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day, 12));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function fromPickerValue(date: Date): string {
  return Platform.OS === 'android'
    ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** С чего открывается выбор, пока дату не указали: середина возрастов, без намёка. */
export function defaultPickerDate(now: Date = new Date()): string {
  return `${now.getFullYear() - 16}-01-01`;
}
