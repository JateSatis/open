import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'open.installation-id';

let cached: Promise<string> | null = null;

/**
 * Не секрет и не идентификатор безопасности — только имя «этой установки
 * приложения» в списке устройств. `expo-crypto` ради него не нужен.
 */
function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;

    return value.toString(16);
  });
}

async function readOrCreate(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);

  if (stored) return stored;

  const created = randomUuid();
  await AsyncStorage.setItem(STORAGE_KEY, created);

  return created;
}

/**
 * Id установки: живёт в хранилище приложения и переживает выход и вход под
 * другим аккаунтом — устройство то же самое. Пропадает с переустановкой.
 */
export function getInstallationId(): Promise<string> {
  if (!cached) {
    cached = readOrCreate().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }

  return cached;
}

/** Только для тестов. */
export function resetInstallationIdCache() {
  cached = null;
}
