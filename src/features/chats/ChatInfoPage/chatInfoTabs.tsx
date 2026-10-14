import type { ChatSummary, Person } from '@/api/chats';
import type { ChatInfoSummary } from '@/api/chatInfo';
import type { InfoStatus, InfoTab } from '@/components/InfoPage';

import { CommonGroupsTab } from './CommonGroupsTab';
import { MediaTab } from './MediaTab';
import { MembersTab } from './MembersTab';
import { groupsSummary, mediaSummary, membersSummary, voicesSummary } from './summaries';
import { VoicesTab } from './VoicesTab';

export type ChatInfoTabsInput = {
  chat: ChatSummary;
  summary: ChatInfoSummary | undefined;
  isMember: boolean;
  other: Person | null;
  currentUserId: string | null;
  online: Set<string>;
  statuses: Map<string, InfoStatus | null>;
  memberQuery: string | null;
  onOpenPerson: (userId: string) => void;
  onOpenChat: (chatId: string) => void;
  onShowInChat: (messageId: string, createdAt: string) => void;
  onRemoveMember: (person: Person) => void;
  onCancelInvite: (person: Person) => void;
  onSearchMembers: () => void;
};

/** Вкладки страницы чата. Пустые — медиа, голосовые, общие группы — не показываются. */
export function chatInfoTabs(input: ChatInfoTabsInput): InfoTab[] {
  const { chat, summary, other } = input;
  const tabs: InfoTab[] = [];
  const media = (summary?.photos ?? 0) + (summary?.videos ?? 0);

  if (chat.kind === 'group') {
    tabs.push({
      key: 'members',
      title: 'Участники',
      summary: membersSummary(chat.participants.length),
      onSearch: input.onSearchMembers,
      render: (tab) => (
        <MembersTab
          tab={tab}
          participants={chat.participants}
          waiting={chat.waiting}
          currentUserId={input.currentUserId}
          ownerId={chat.ownerId}
          online={input.online}
          statuses={input.statuses}
          query={input.memberQuery}
          onOpenPerson={input.onOpenPerson}
          onRemove={input.onRemoveMember}
          onCancelInvite={input.onCancelInvite}
        />
      ),
    });
  }

  if (media > 0) {
    tabs.push({
      key: 'media',
      title: 'Медиа',
      summary: mediaSummary(summary?.photos ?? 0, summary?.videos ?? 0),
      render: (tab) => <MediaTab tab={tab} chatId={chat.id} onShowInChat={input.onShowInChat} />,
    });
  }

  if ((summary?.voices ?? 0) > 0) {
    tabs.push({
      key: 'voices',
      title: 'Голосовые',
      summary: voicesSummary(summary?.voices ?? 0),
      render: (tab) => <VoicesTab tab={tab} chatId={chat.id} onShowInChat={input.onShowInChat} />,
    });
  }

  if (other && input.isMember && (summary?.commonGroups ?? 0) > 0) {
    tabs.push({
      key: 'groups',
      title: 'Общие группы',
      summary: groupsSummary(summary?.commonGroups ?? 0),
      render: (tab) => (
        <CommonGroupsTab tab={tab} otherUserId={other.id} onOpenChat={input.onOpenChat} />
      ),
    });
  }

  return tabs;
}
