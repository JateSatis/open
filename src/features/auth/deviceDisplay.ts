import type { Device } from '@/api/account';

const PLATFORM_NAMES: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Веб' };

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function deviceTitle(device: Pick<Device, 'model' | 'platform'>): string {
  return device.model ?? PLATFORM_NAMES[device.platform] ?? 'Устройство';
}

/** «Android 15 · Open 1.0.0» */
export function deviceDetails(device: Pick<Device, 'platform' | 'osVersion' | 'appVersion'>): string {
  const platform = PLATFORM_NAMES[device.platform] ?? device.platform;
  const os = device.osVersion ? `${platform} ${device.osVersion}` : platform;

  return device.appVersion ? `${os} · Open ${device.appVersion}` : os;
}

/**
 * Последняя активность. Отметка обновляется не чаще раза в пять минут, поэтому
 * всё свежее — «только что», а не точные минуты, которым нельзя верить.
 */
export function formatLastSeen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (now.getTime() - date.getTime() < 10 * 60_000) return 'только что';
  if (sameDay(date, now)) return `сегодня в ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(date, yesterday)) return `вчера в ${time}`;

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Текущее устройство — первым, остальные — по свежести. */
export function orderDevices(devices: Device[], installationId: string | null): Device[] {
  const current = devices.filter((device) => device.installationId === installationId);
  const others = devices.filter((device) => device.installationId !== installationId);

  return [...current, ...others];
}
