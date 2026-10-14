import { useCallback, useState } from 'react';

import type { ChannelRole } from './ChannelInfoMenu';

import { confirm } from '@/components/ConfirmDialog/store';
import { useSubscriptionActions } from '@/features/channels/subscription';

/**
 * Подписка со страницы канала: подписаться без «Чатов» (следующим шагом
 * карточка предложит их), отписаться — после вопроса. `justSubscribed` —
 * подписался здесь и сейчас: карточка не прячется, а ведёт к «Чатам».
 */
export function useInfoSubscription(channelId: string, role: ChannelRole) {
  const actions = useSubscriptionActions(channelId);
  const [justSubscribed, setJustSubscribed] = useState(false);

  const subscribe = useCallback(async () => {
    if (await actions.subscribe(false)) setJustSubscribed(true);
  }, [actions]);

  const unsubscribe = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Отписаться от канала?',
      message:
        role === 'reader'
          ? 'Канал уйдёт из «Чатов», новые посты перестанут приходить.'
          : 'Канал перестанет быть в ваших подписках.',
      confirmLabel: 'Отписаться',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!confirmed) return;

    setJustSubscribed(false);
    await actions.unsubscribe();
  }, [actions, role]);

  return {
    justSubscribed,
    subscribe,
    unsubscribe,
    setInChats: actions.setInChats,
    setNotify: actions.setNotify,
  };
}
