import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';

import { InAppMessageToast } from './index';

import {
  subscribeToUserEvents,
  type IncomingInvite,
  type IncomingMessage,
  type UserChannelHandlers,
} from '@/api/chats';
import { useSession } from '@/features/auth/useSession';
import { showNotice } from '@/features/notifications/alertsStore';
import { setActiveChatId } from '@/store/activeChat';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  subscribeToUserEvents: jest.fn(),
}));

jest.mock('@/api/invites', () => ({}));

const mockedSubscribe = subscribeToUserEvents as jest.MockedFunction<typeof subscribeToUserEvents>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

let handlers: UserChannelHandlers | null = null;
const deliver = (message: IncomingMessage) => handlers?.onMessage(message);
const deliverInvite = (invite: IncomingInvite) => handlers?.onInvite(invite);

const incoming: IncomingMessage = {
  messageId: 'm1',
  chatId: 'chat-1',
  authorId: 'user-2',
  authorName: 'Марина',
  messageKind: 'text',
  text: 'ты где',
  createdAt: '2026-09-16T10:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  setActiveChatId(null);
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedSubscribe.mockImplementation((_userId, received) => {
    handlers = received;
    return () => {};
  });
});

describe('InAppMessageToast', () => {
  it('stays out of the way until a message arrives', async () => {
    await renderWithQuery(<InAppMessageToast />);

    expect(screen.queryByText('Марина')).toBeNull();
  });

  it('shows who wrote and what they wrote', async () => {
    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('ты где')).toBeTruthy();
  });

  it('opens the chat it came from when tapped', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);
    await user.press(await screen.findByText('ты где'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-1');
    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('keeps quiet about the chat the user is already reading', async () => {
    setActiveChatId('chat-1');

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('still reports a message from another chat while one is open', async () => {
    setActiveChatId('chat-2');

    await renderWithQuery(<InAppMessageToast />);

    deliver(incoming);

    expect(await screen.findByText('ты где')).toBeTruthy();
  });

  it('announces an invite and opens the chat it invites to', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliverInvite({
      chatId: 'chat-7',
      inviterId: 'user-2',
      inviterName: 'Марина',
      chatTitle: 'Поход',
    });
    expect(await screen.findByText('Марина')).toBeTruthy();
    await user.press(screen.getByText('Зовёт вас в чат «Поход»'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-7');
  });

  it('runs the action of a notice that carries one and closes', async () => {
    const retry = jest.fn();

    await renderWithQuery(<InAppMessageToast />);
    await act(async () => showNotice('Изменения не сохранены', 'error', { label: 'Повторить', run: retry }));

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Повторить' }));

    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Изменения не сохранены')).toBeNull());
  });

  it('leaves no channel behind on unmount', async () => {
    const unsubscribe = jest.fn();
    mockedSubscribe.mockReturnValue(unsubscribe);

    await renderWithQuery(<InAppMessageToast />);
    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
