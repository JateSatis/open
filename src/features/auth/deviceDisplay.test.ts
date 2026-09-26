import type { Device } from '@/api/account';

import { deviceDetails, deviceTitle, formatLastSeen, orderDevices } from './deviceDisplay';

const now = new Date(2026, 8, 26, 15, 0);

function device(overrides: Partial<Device>): Device {
  return {
    id: 'd',
    installationId: 'i',
    platform: 'android',
    model: 'realme RMX3840',
    osVersion: '15',
    appVersion: '1.0.0',
    lastSeenAt: now.toISOString(),
    ...overrides,
  };
}

describe('deviceDisplay', () => {
  it('names the device by model, falling back to the platform', () => {
    expect(deviceTitle(device({}))).toBe('realme RMX3840');
    expect(deviceTitle(device({ model: null, platform: 'ios' }))).toBe('iOS');
  });

  it('describes OS and app version', () => {
    expect(deviceDetails(device({}))).toBe('Android 15 · Open 1.0.0');
    expect(deviceDetails(device({ osVersion: null, appVersion: null }))).toBe('Android');
  });

  it('formats last activity relative to now', () => {
    expect(formatLastSeen(new Date(2026, 8, 26, 14, 55).toISOString(), now)).toBe('только что');
    expect(formatLastSeen(new Date(2026, 8, 26, 9, 5).toISOString(), now)).toBe('сегодня в 09:05');
    expect(formatLastSeen(new Date(2026, 8, 25, 22, 40).toISOString(), now)).toBe('вчера в 22:40');
    expect(formatLastSeen(new Date(2026, 7, 3, 12, 0).toISOString(), now)).toBe('03.08.2026');
  });

  it('puts the current device first', () => {
    const list = [
      device({ id: 'a', installationId: 'other' }),
      device({ id: 'b', installationId: 'mine' }),
    ];

    expect(orderDevices(list, 'mine').map((item) => item.id)).toEqual(['b', 'a']);
  });
});
