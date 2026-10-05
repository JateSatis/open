import type { ReactElement } from 'react';
import { makeMutable } from 'react-native-reanimated';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';

/**
 * Строка переписки, чья копия сейчас поднята над шитом комментариев. Строка
 * с этим ключом прозрачна, копия в окне шита видна — обе читают одно и то же
 * значение на UI-потоке, поэтому смена «строка ↔ копия» происходит в одном
 * кадре, без двойника и без пустого места.
 */
export const liftedRowKey = makeMutable<string | null>(null);

/**
 * Прозрачность переписки под шитом: пока шит открыт, остальные сообщения
 * растворены до фона чата. Ведёт её окно шита, читает список переписки.
 */
export const chatFade = makeMutable(1);

/** Окно списка переписки по вертикали, в координатах окна. */
export type ChatArea = { top: number; bottom: number };

/**
 * Экран переписки под шитом: где стоит строка сообщения, где окно списка и
 * как нарисовать копию облачка. Без него (лента, профиль) шит открывается без
 * поднятого сообщения.
 */
export type CommentsLiftHost = {
  /** Угол и размер строки в окне; `null` — строки сейчас нет на экране. */
  measureRow: (rowKey: string) => Promise<AnchorRect | null>;
  measureArea: () => Promise<ChatArea | null>;
  /** Копия облачка строки — неинтерактивная; `null` — строки больше нет. */
  renderRow: (rowKey: string) => ReactElement | null;
  /** В строке фото или видео — копии нужно время, чтобы их нарисовать. */
  hasMedia: (rowKey: string) => boolean;
};
