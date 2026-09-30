import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

import { getMicrophoneAccess, requestMicrophoneAccess } from '@/features/media';

/**
 * Микрофон — до входа в звонок: участник чата в звонке говорит, и без
 * микрофона звонок не создаётся. Отказ объясняется словами, а не молчанием.
 */
export async function ensureCallMicrophone(): Promise<boolean> {
  let access = await getMicrophoneAccess();

  if (access === 'undetermined') access = await requestMicrophoneAccess();
  if (access === 'granted') return true;

  Alert.alert(
    'Нужен микрофон',
    access === 'blocked'
      ? 'В звонке участники чата говорят. Разрешите Open доступ к микрофону в настройках телефона.'
      : 'В звонке участники чата говорят, поэтому без доступа к микрофону звонок не начать.',
    access === 'blocked'
      ? [
          { text: 'Не сейчас', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
        ]
      : [{ text: 'Понятно' }],
  );

  return false;
}

/**
 * Уведомление службы звонка на Android 13+ видно только с разрешением на
 * уведомления: по нему свёрнутый звонок напоминает «вы в эфире». Спрашиваем
 * до входа и дожидаемся ответа — системный диалог поверх подключения
 * останавливал бы его. Отказ не мешает звонку, поэтому его не объясняем.
 */
export async function askNotificationsOnce(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;

  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

    if (await PermissionsAndroid.check(permission)) return;

    await PermissionsAndroid.request(permission);
  } catch {
    // Не спросили — звонок идёт без уведомления.
  }
}
