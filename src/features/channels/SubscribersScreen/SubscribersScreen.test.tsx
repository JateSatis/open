import { screen, userEvent } from '@testing-library/react-native';

import { SubscribersScreen } from '.';

import { listChannelSubscribers, listChatSubscribers, type Subscriber } from '@/api/subscriptions';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('@/navigation', () => ({
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
}));
jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => 'owner-1' }));

function subscriber(id: string, inChats: boolean | null): Subscriber {
  return {
    id: `s-${id}`,
    userId: id,
    displayName: `Человек ${id}`,
    username: `user_${id}`,
    avatarUrl: null,
    inChats,
    subscribedAt: '2026-10-11T10:00:00Z',
  };
}

beforeEach(() => jest.clearAllMocks());

describe('SubscribersScreen', () => {
  it('lists every subscriber and marks the ones who keep the channel in chats', async () => {
    jest
      .mocked(listChannelSubscribers)
      .mockResolvedValue([subscriber('a', true), subscriber('b', false)]);

    await renderWithQuery(<SubscribersScreen target={{ kind: 'channel', id: 'channel-1' }} />);

    expect(await screen.findByText('Человек a')).toBeTruthy();
    expect(screen.getByText('Человек b')).toBeTruthy();
    expect(screen.getAllByText('в чатах')).toHaveLength(1);
    expect(listChannelSubscribers).toHaveBeenCalledWith('channel-1', null);
  });

  it('opens the profile on a tap', async () => {
    jest.mocked(listChannelSubscribers).mockResolvedValue([subscriber('a', true)]);

    await renderWithQuery(<SubscribersScreen target={{ kind: 'channel', id: 'channel-1' }} />);
    await userEvent.setup().press(await screen.findByRole('button', { name: 'Человек a' }));

    expect(mockPush).toHaveBeenCalledWith({ name: 'Person', params: { userId: 'a' } });
  });

  it('lists the subscribers of a chat without the «в чатах» mark', async () => {
    jest
      .mocked(listChatSubscribers)
      .mockResolvedValue([subscriber('a', null), subscriber('b', null)]);

    await renderWithQuery(<SubscribersScreen target={{ kind: 'chat', id: 'chat-1' }} />);

    expect(await screen.findByText('Человек a')).toBeTruthy();
    expect(screen.getByText('Человек b')).toBeTruthy();
    expect(screen.queryByText('в чатах')).toBeNull();
    expect(listChatSubscribers).toHaveBeenCalledWith('chat-1', null);
    expect(listChannelSubscribers).not.toHaveBeenCalled();
  });

  it('says so when there is nobody yet', async () => {
    jest.mocked(listChannelSubscribers).mockResolvedValue([]);

    await renderWithQuery(<SubscribersScreen target={{ kind: 'channel', id: 'channel-1' }} />);

    expect(await screen.findByText('Подписчиков пока нет.')).toBeTruthy();
  });
});
