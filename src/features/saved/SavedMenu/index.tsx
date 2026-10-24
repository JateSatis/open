import { useMemo, type ReactNode } from 'react';

import type { SavedTag } from '@/api/saved';
import {
  MessageContextMenu,
  type AnchorRect,
  type MenuAccessory,
  type MenuAnchor,
} from '@/features/chats/MessageContextMenu';
import { savedMenuActions, type SavedActionId, type SavedTab } from '@/features/saved/savedActions';
import { isPendingNote, type SavedItem } from '@/features/saved/savedCopy';
import { SavedTagBlock, TAG_BLOCK_HEIGHT } from '@/features/saved/SavedTagBlock';
import type { SavedActions } from '@/features/saved/useSavedActions';

/** Над чем открыто меню: запись, где она на экране и на какой вкладке. */
export type SavedMenuTarget = { savedId: string; anchor: MenuAnchor; tab: SavedTab };

export type SavedMenuProps = {
  target: SavedMenuTarget | null;
  /** Запись — свежая, из кеша: теги и отметки меняются, пока меню открыто. */
  saved: SavedItem | null;
  viewport: AnchorRect | null;
  /** Копия строки над затемнением. */
  preview: ReactNode;
  /** Куда растёт строка, когда ей ставят тег: «Все» — перевёрнутый список. */
  previewGrowth: 'up' | 'down';
  tags: SavedTag[];
  actions: Pick<SavedActions, 'toggleTag' | 'createTag'>;
  onAction: (id: SavedActionId, saved: SavedItem) => void;
  onClose: () => void;
};

/**
 * Меню записи «Сохранённых» — то же меню сообщения, но над пунктами вместо
 * реакций — теги записи, а пункты свои (`savedMenuActions`).
 */
export function SavedMenu({
  target,
  saved,
  viewport,
  preview,
  previewGrowth,
  tags,
  actions,
  onAction,
  onClose,
}: SavedMenuProps) {
  const { toggleTag, createTag } = actions;
  const menuActions = useMemo(
    () => (saved && target ? savedMenuActions(saved, target.tab) : []),
    [saved, target],
  );

  const accessory = useMemo<MenuAccessory | null>(
    () =>
      // Неотправленной заметки сервер ещё не знает — тегов у неё нет.
      saved && !isPendingNote(saved)
        ? {
            collapsedHeight: TAG_BLOCK_HEIGHT,
            render: (props) => (
              <SavedTagBlock
                {...props}
                tags={tags}
                selectedIds={saved.tagIds}
                onToggle={(tagId) => toggleTag(saved, tagId)}
                onCreate={(name) => createTag(saved, name)}
              />
            ),
          }
        : null,
    [createTag, saved, tags, toggleTag],
  );

  return (
    <MessageContextMenu
      // Запись удалили, пока меню было открыто (с другого места) — меню закрывается.
      anchor={saved ? (target?.anchor ?? null) : null}
      viewport={viewport}
      preview={preview}
      previewGrowth={previewGrowth}
      actions={menuActions}
      reactions={null}
      accessory={accessory}
      onAction={(id) => {
        if (saved) onAction(id, saved);
      }}
      onClose={onClose}
    />
  );
}
