import { useCallback } from 'react';

import { AvatarPickSheet, type AvatarSheetOwner } from './index';

import type { MediaLibraryItem, PreparedAvatar } from '@/features/media';
import { prepareAvatarFrom } from '@/features/media/avatarFromAsset';

export type MediaAvatarSheetProps = {
  /** Чей это шит: открывается `openMediaSheet(owner)`. */
  owner: AvatarSheetOwner;
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
export function MediaAvatarSheet({ owner, onDone }: MediaAvatarSheetProps) {
  // Запечённую правку забираем сейчас: правки шита уходят вместе с его окном.
  const onPick = useCallback(
    (asset: MediaLibraryItem) => onDone(prepareAvatarFrom(asset)),
    [onDone],
  );

  return <AvatarPickSheet owner={owner} onPick={onPick} />;
}
