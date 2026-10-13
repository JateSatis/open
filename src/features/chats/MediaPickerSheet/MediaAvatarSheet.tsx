import { useCallback } from 'react';

import { AvatarPickSheet } from './index';

import type { MediaLibraryItem, PreparedAvatar } from '@/features/media';
import { prepareAvatarFrom } from '@/features/media/avatarFromAsset';

export type MediaAvatarSheetProps = {
  /**
   * «Готово» в редакторе: шит закрывается, а фото — уже с правками, квадратное
   * и сжатое — готовится в фоне. Хозяин показывает ожидание и ошибку сам.
   */
  onDone: (avatar: Promise<PreparedAvatar>) => void;
};

/**
 * Шит аватарки для профиля и канала: выбранное фото с правками — сразу файл
 * аватарки. Отдельным файлом, чтобы шит чата не тянул за собой медиатеку и
 * запекание.
 */
export function MediaAvatarSheet({ onDone }: MediaAvatarSheetProps) {
  // Запечённую правку забираем сейчас: правки шита уходят вместе с его окном.
  const onPick = useCallback(
    (asset: MediaLibraryItem) => onDone(prepareAvatarFrom(asset)),
    [onDone],
  );

  return <AvatarPickSheet onPick={onPick} />;
}
