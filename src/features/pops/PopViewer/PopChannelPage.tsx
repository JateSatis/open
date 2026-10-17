import { memo, useCallback, useMemo } from 'react';

import type { PopChannelFace } from './popFeed';
import { PopPage, type PopPageMode } from './PopPage';
import { useOpenChannel, type OpenChannelMode } from './useOpenChannel';
import { usePopReactionActions } from './usePopReactionActions';

import type { Pop } from '@/api/pops';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChannel } from '@/features/channels/useChannel';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import { useCanPublishState } from '@/features/pops/queries';
import { notePopChannelOpened } from '@/features/recs/journal/popJournal';

export type PopChannelPageProps = {
  pop: Pop;
  /** Имя и аватарка канала, пока канал не загружен. */
  face: PopChannelFace | null;
  channelLink: OpenChannelMode;
  width: number;
  height: number;
  mode: PopPageMode;
  live: boolean;
  onOpenComments: (pop: Pop) => void;
  commentsOpen: boolean;
};

/**
 * Страница просмотра со всем, что зависит от канала попа: шапка, подписка,
 * право публиковать (ряд реакции), переход к каналу. Канал — свой у каждой
 * страницы: в выдаче поиска соседние попсы бывают из разных каналов. В дереве
 * не больше трёх страниц, а запросы одного канала общие — лента канала
 * спрашивает его, как и раньше, один раз.
 */
export const PopChannelPage = memo(function PopChannelPage({
  pop,
  face,
  channelLink,
  ...page
}: PopChannelPageProps) {
  const channelId = pop.channelId;
  const { canPublish } = useCanPublishState(channelId);
  const channel = useChannel(channelId);
  const { onReaction, onDoubleTap } = usePopReactionActions(canPublish);
  const openChannel = useOpenChannel(channelId, channelLink);
  const onOpenChannel = useCallback(() => {
    notePopChannelOpened(pop.id, channelId);
    openChannel();
  }, [channelId, openChannel, pop.id]);

  // Отсюда подписка — без чатов: смотрящий попсы ещё не решил, нужен ли ему
  // канал в «Чатах». Следующим шагом кнопка предлагает именно это.
  const { status } = useChannelSubscription(channelId);
  const { subscribe: subscribeTo, setInChats } = useSubscriptionActions(channelId);
  const subscribe = useMemo(() => {
    if (status === 'none') return { label: 'Подписаться', onPress: () => void subscribeTo(false) };
    if (status === 'subscriber') {
      return { label: 'Добавить в чаты', onPress: () => void setInChats(true) };
    }

    return null;
  }, [setInChats, status, subscribeTo]);

  return (
    <PopPage
      pop={pop}
      channelTitle={channel.data?.title ?? face?.title ?? null}
      channelAvatarUrl={channel.data ? (channel.data.avatarUrl ?? null) : (face?.avatarUrl ?? null)}
      subscribe={subscribe}
      onReaction={onReaction}
      onDoubleTap={onDoubleTap}
      onOpenChannel={onOpenChannel}
      {...page}
    />
  );
});
