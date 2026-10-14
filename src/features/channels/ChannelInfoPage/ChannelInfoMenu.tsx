import { HeaderMenu } from '@/components/HeaderMenu';
import { InfoBarIcon } from '@/components/InfoPage';
import type { MenuAction } from '@/components/MenuList';

export type ChannelInfoMenuItem = 'search_posts' | 'copy_link' | 'subscribers' | 'unsubscribe';

const SEARCH_POSTS: MenuAction<ChannelInfoMenuItem> = {
  id: 'search_posts',
  label: 'Поиск по постам',
  icon: { ios: 'magnifyingglass', android: 'search', web: 'search' },
};
const COPY_LINK: MenuAction<ChannelInfoMenuItem> = {
  id: 'copy_link',
  label: 'Скопировать ссылку',
  icon: { ios: 'link', android: 'link', web: 'link' },
};
const SUBSCRIBERS: MenuAction<ChannelInfoMenuItem> = {
  id: 'subscribers',
  label: 'Подписчики',
  icon: { ios: 'person.2', android: 'group', web: 'group' },
};
const UNSUBSCRIBE: MenuAction<ChannelInfoMenuItem> = {
  id: 'unsubscribe',
  label: 'Отписаться',
  destructive: true,
  icon: { ios: 'xmark.circle', android: 'cancel', web: 'cancel' },
};

/** Кто я каналу на его странице. */
export type ChannelRole = 'unknown' | 'owner' | 'publisher' | 'none' | 'subscriber' | 'reader';

/**
 * Пункты «⋮» страницы канала:
 * - владелец — поиск по постам, ссылка, подписчики;
 * - подписчик и читатель — поиск, ссылка, отписка;
 * - посторонний — поиск и ссылка.
 */
export function channelInfoMenuActions(role: ChannelRole): MenuAction<ChannelInfoMenuItem>[] {
  if (role === 'owner') return [SEARCH_POSTS, COPY_LINK, SUBSCRIBERS];
  if (role === 'subscriber' || role === 'reader') return [SEARCH_POSTS, COPY_LINK, UNSUBSCRIBE];

  return [SEARCH_POSTS, COPY_LINK];
}

export type ChannelInfoMenuProps = {
  role: ChannelRole;
  onSelect: (item: ChannelInfoMenuItem) => void;
};

/** «⋮» справа в панели страницы канала. */
export function ChannelInfoMenu({ role, onSelect }: ChannelInfoMenuProps) {
  return (
    <HeaderMenu
      testID="info-menu"
      accessibilityLabel="Меню"
      actions={channelInfoMenuActions(role)}
      onSelect={onSelect}
      icon={<InfoBarIcon icon={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }} />}
    />
  );
}
