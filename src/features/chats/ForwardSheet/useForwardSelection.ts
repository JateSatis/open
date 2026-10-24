import { useCallback, useMemo, useState } from 'react';

import { createSavedTag, type SavedTag } from '@/api/saved';
import type { ForwardTargets } from '@/features/chats/sendForwardPick';
import { showNotice } from '@/features/notifications/alertsStore';
import { useSavedTags } from '@/features/saved/useSavedTags';

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);

  if (next.has(value)) next.delete(value);
  else next.add(value);

  return next;
}

/**
 * Кого выбрали в листе «Кому переслать»: чаты, «Сохранённые» и их теги с
 * «Посмотреть позже». Тег или «Посмотреть позже» сами отмечают «Сохранённые»
 * адресатом: настраивают их, чтобы туда сохранить.
 */
export function useForwardSelection() {
  const [chatIds, setChatIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saved, setSaved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagIds, setTagIds] = useState<ReadonlySet<string>>(() => new Set());
  const [watchLater, setWatchLater] = useState(false);
  // Новые теги этого листа — первыми после «+», пока лист открыт: порядок по
  // использованию обновится при следующем открытии.
  const [created, setCreated] = useState<SavedTag[]>([]);
  const { tags: known } = useSavedTags();

  const tags = useMemo(() => {
    const fresh = new Set(created.map((tag) => tag.id));

    return [...created, ...known.filter((tag) => !fresh.has(tag.id))];
  }, [created, known]);

  const toggleChat = useCallback((chatId: string) => setChatIds((set) => toggled(set, chatId)), []);
  const toggleSaved = useCallback(() => setSaved((value) => !value), []);
  const toggleSettings = useCallback(() => setSettingsOpen((value) => !value), []);

  const toggleTag = useCallback(
    (tagId: string) => {
      if (!tagIds.has(tagId)) setSaved(true);
      setTagIds((set) => toggled(set, tagId));
    },
    [tagIds],
  );

  const toggleWatchLater = useCallback(() => {
    if (!watchLater) setSaved(true);
    setWatchLater(!watchLater);
  }, [watchLater]);

  // Тег создаётся сразу, а не при отправке: человек его уже видел, и отказ
  // отправки не должен его терять.
  const createTag = useCallback(
    async (name: string) => {
      try {
        // Имя уже было — база отдаёт тот тег; он тоже встаёт первым, чтобы
        // выбор не спрятался за «Показать все».
        const tag = await createSavedTag(name);

        setCreated((list) => [tag, ...list.filter((item) => item.id !== tag.id)]);
        setTagIds((set) => new Set(set).add(tag.id));
        setSaved(true);
      } catch {
        showNotice('Не удалось создать тег', 'error');
      }
    },
    [],
  );

  const targets: ForwardTargets = useMemo(
    () => ({
      chatIds: [...chatIds],
      saved: saved ? { tagIds: [...tagIds], watchLater } : null,
    }),
    [chatIds, saved, tagIds, watchLater],
  );

  return {
    chatIds,
    toggleChat,
    saved,
    toggleSaved,
    settingsOpen,
    toggleSettings,
    tags,
    tagIds,
    toggleTag,
    createTag,
    watchLater,
    toggleWatchLater,
    targets,
    hasTargets: chatIds.size > 0 || saved,
  };
}
