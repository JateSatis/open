import { useCallback, useState } from 'react';

import type { PreparedAvatar } from '@/features/media';

export type PreparedAvatarState = {
  /** Фото после «Готово» ещё обрезается и сжимается. */
  preparing: boolean;
  /** Фото не подготовилось — объяснить и дать выбрать другое. */
  failed: boolean;
  /** Обработчик «Готово» шита аватарки (`MediaAvatarSheet.onDone`). */
  onDone: (avatar: Promise<PreparedAvatar>) => void;
  clearFailed: () => void;
};

/**
 * Итог шита аватарки: «Готово» отдаёт обещание квадратного сжатого файла,
 * а форме нужен лишь готовый файл (`onReady`) и честное «готовится» / «не вышло».
 */
export function usePreparedAvatar(onReady: (uri: string) => void): PreparedAvatarState {
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);

  const onDone = useCallback(
    (avatar: Promise<PreparedAvatar>) => {
      setFailed(false);
      setPreparing(true);
      avatar
        .then((prepared) => onReady(prepared.uri))
        .catch(() => setFailed(true))
        .finally(() => setPreparing(false));
    },
    [onReady],
  );

  const clearFailed = useCallback(() => setFailed(false), []);

  return { preparing, failed, onDone, clearFailed };
}
