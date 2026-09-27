import {
  impactAsync,
  ImpactFeedbackStyle,
  notificationAsync,
  NotificationFeedbackType,
  selectionAsync,
} from 'expo-haptics';

/** Отклик не главное: телефон без вибромотора не должен ронять запись. */
function quietly(run: () => Promise<void>) {
  run().catch(() => undefined);
}

/**
 * Тактильные отметки записи голосового. Палец закрывает кнопку, глаза
 * смотрят на собеседника — начало, замок, отмену и отправку человек
 * должен почувствовать, а не разглядеть.
 */
export const recordingHaptics = {
  started: () => quietly(() => impactAsync(ImpactFeedbackStyle.Medium)),
  locked: () => quietly(() => selectionAsync()),
  cancelled: () => quietly(() => notificationAsync(NotificationFeedbackType.Warning)),
  sent: () => quietly(() => impactAsync(ImpactFeedbackStyle.Light)),
};
