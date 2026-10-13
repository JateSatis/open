import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Насколько раскрыто фото (0…1): поверх раскрытого фото иконки и текст
 * белые. Отдельный контекст — чтобы кнопки панели из слотов страницы
 * (карандаш, «⋮») перекрашивались вместе со стрелкой.
 */
export const InfoPhotoProgressContext = createContext<SharedValue<number> | null>(null);

export function usePhotoProgress(): SharedValue<number> | null {
  return useContext(InfoPhotoProgressContext);
}
