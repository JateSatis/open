import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';

import { InAppMessageToast } from './index';
import { InAppNoticeToast } from './NoticeToast';
import type { ChatSummary, IncomingMessage, IncomingPop } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { dismissAlert, showAlert, showNotice } from '@/features/notifications/alertsStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => 'user-1' }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));

const channel = { id: 'channel-1', title: 'Плейлисты', avatarUrl: null };
const post: IncomingMessage = {
  messageId: 'p1',
  chatId: 'posts-1',
  authorId: 'owner-1',
  authorName: 'Владелец',
  messageKind: 'text',
  text: 'новый трек',
  channel,
  subscribedChatTitle: null,
  notify: true,
};
const pop: IncomingPop = {
  popId: 'pop-1',
  chatId: 'posts-1',
  channel,
  notify: true,
  createdAt: '2026-10-11T10:00:00Z',
};

const incoming: IncomingMessage = {
  messageId: 'm1',
  chatId: 'chat-1',
  authorId: 'user-2',
  authorName: 'Марина',
  messageKind: 'text',
  text: 'ты где',
  channel: null,
  subscribedChatTitle: null,
  notify: true,
};

beforeEach(() => {
  mockPush.mockClear();
  dismissAlert();
});

describe('InAppMessageToast', () => {
  it('shows who wrote and what they wrote', async () => {
    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({ kind: 'message', ...incoming }));

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('ты где')).toBeTruthy();
  });

  it('opens the chat it came from when tapped', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({ kind: 'message', ...incoming }));
    await user.press(await screen.findByText('ты где'));

    expect(mockPush).toHaveBeenCalledWith({
      name: 'Chat',
      params: { chatId: 'chat-1', from: 'notification' },
    });
    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('signs a group message by the group — its title and photo — and names the author', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    queryClient.setQueryData<Partial<ChatSummary>[]>(chatsQueryKey, [
      {
        id: 'group-1',
        kind: 'group',
        title: 'Поход',
        avatarUrl: 'https://x/g.jpg',
        channel: null,
        participants: [],
        waiting: [],
      },
    ]);

    await render(
      <QueryClientProvider client={queryClient}>
        <InAppMessageToast />
      </QueryClientProvider>,
    );

    await act(() => showAlert({ kind: 'message', ...incoming, chatId: 'group-1' }));

    expect(await screen.findByText('Марина: ты где')).toBeTruthy();
    expect(screen.getByLabelText('Новое сообщение в «Поход» от Марина')).toBeTruthy();
    // Фото группы подписано её названием; буквы на его месте нет.
    expect(screen.getByLabelText('Поход')).toBeTruthy();
    expect(screen.queryByText('П')).toBeNull();
    queryClient.clear();
  });

  it('titles a message in a subscribed dialogue by the dialogue and names the author', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({
      kind: 'message',
      ...incoming,
      chatId: 'their-chat',
      authorName: 'Пётр',
      text: 'Аня, привет',
      subscribedChatTitle: 'Аня и Пётр',
    }));

    expect(await screen.findByText('Аня и Пётр')).toBeTruthy();
    expect(screen.getByText('Пётр: Аня, привет')).toBeTruthy();

    await user.press(screen.getByText('Пётр: Аня, привет'));

    expect(mockPush).toHaveBeenCalledWith({
      name: 'Chat',
      params: { chatId: 'their-chat', from: 'notification' },
    });
  });

  it('announces an invite and opens the chat it invites to', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({
      kind: 'invite',
      chatId: 'chat-7',
      inviterId: 'user-2',
      inviterName: 'Марина',
      chatTitle: 'Поход',
    }));
    expect(await screen.findByText('Марина')).toBeTruthy();
    await user.press(screen.getByText('Зовёт вас в чат «Поход»'));

    expect(mockPush).toHaveBeenCalledWith({
      name: 'Chat',
      params: { chatId: 'chat-7', from: 'notification' },
    });
  });

  it('signs a channel post with the channel and opens its «Посты»', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({ kind: 'message', ...post }));
    expect(await screen.findByText('Плейлисты')).toBeTruthy();
    expect(screen.queryByText('Владелец')).toBeNull();
    await user.press(screen.getByText('новый трек'));

    expect(mockPush).toHaveBeenCalledWith({
      name: 'Channel',
      params: { channelId: 'channel-1', section: 'posts' },
    });
  });

  it('announces a new pop and opens the channel on «Попсы»', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    await act(() => showAlert({ kind: 'pop', ...pop }));
    await user.press(await screen.findByText('Новый попс'));

    expect(mockPush).toHaveBeenCalledWith({
      name: 'Channel',
      params: { channelId: 'channel-1', section: 'pops' },
    });
  });

  it.each([InAppMessageToast, InAppNoticeToast])('runs a local notice action and closes', async (Toast) => {
    const retry = jest.fn();

    await renderWithQuery(<Toast />);
    await act(async () =>
      showNotice('Изменения не сохранены', 'error', { label: 'Повторить', run: retry }),
    );

    await userEvent.setup().press(await screen.findByTestId('notice-action-button'));

    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Изменения не сохранены')).toBeNull());
  });
});
