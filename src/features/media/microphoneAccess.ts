import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

/**
 * `blocked` — отказано так, что система больше не покажет диалог: включить
 * микрофон можно только в настройках, и интерфейс должен туда отправить.
 */
export type MicrophoneAccess = 'granted' | 'undetermined' | 'blocked';

type PermissionLike = { granted: boolean; canAskAgain: boolean };

function toAccess(permission: PermissionLike): MicrophoneAccess {
  if (permission.granted) return 'granted';

  return permission.canAskAgain ? 'undetermined' : 'blocked';
}

/** Текущее состояние, без диалога. */
export async function getMicrophoneAccess(): Promise<MicrophoneAccess> {
  return toAccess(await getRecordingPermissionsAsync());
}

/** Показывает системный диалог, если его ещё можно показать. */
export async function requestMicrophoneAccess(): Promise<MicrophoneAccess> {
  return toAccess(await requestRecordingPermissionsAsync());
}
