import { makeMutable } from 'react-native-reanimated';

/**
 * Ход шита комментариев: 0 — закрыт (или утащен за край), 1 — стоит на
 * месте. Ведёт окно шита на UI-потоке, читает просмотр попа: видео
 * уменьшается в область над шитом и идёт за пальцем, когда шит тянут.
 */
export const commentsSheetOpen = makeMutable(0);

/** Верх шита на месте, в координатах окна, — нижняя граница области над ним. */
export const commentsSheetTop = makeMutable(0);
