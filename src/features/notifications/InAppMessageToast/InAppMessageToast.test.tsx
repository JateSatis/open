import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { InAppMessageToast } from './index';

import { subscribeToIncomingMessages, type IncomingMessage } from '@/api/chats';
import { useSession } from '@/features/auth/useSession';
import { setActiveChatId } from '@/store/activeChat';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  subscribeToIncomingMessages: jest.fn(),
}));

const mockedSubscribe = subscribeToIncomingMessages as jest.MockedFunction<
  typeof subscribeToIncomingMessages
>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

let deliver: ((message: IncomingMessage) => void) | null = null;

const incoming: IncomingMessage = {
  messageId: 'm1',
  chatId: 'chat-1',
  authorId: 'user-2',
  authorName: 'Марина',
  text: 'ты где',
  createdAt: '2026-09-16T10:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  deliver = null;
  setActiveChatId(null);
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedSubscribe.mockImplementation((_userId, onMessage) => {
    deliver = onMessage;
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

    deliver?.(incoming);

    expect(await screen.findByText('Марина')).toBeTruthy();
    expect(screen.getByText('ты где')).toBeTruthy();
  });

  it('opens the chat it came from when tapped', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<InAppMessageToast />);

    deliver?.(incoming);
    await user.press(await screen.findByText('ты где'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-1');
    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('keeps quiet about the chat the user is already reading', async () => {
    setActiveChatId('chat-1');

    await renderWithQuery(<InAppMessageToast />);

    deliver?.(incoming);

    await waitFor(() => expect(screen.queryByText('ты где')).toBeNull());
  });

  it('still reports a message from another chat while one is open', async () => {
    setActiveChatId('chat-2');

    await renderWithQuery(<InAppMessageToast />);

    deliver?.(incoming);

    expect(await screen.findByText('ты где')).toBeTruthy();
  });

  it('leaves no channel behind on unmount', async () => {
    const unsubscribe = jest.fn();
    mockedSubscribe.mockReturnValue(unsubscribe);

    await renderWithQuery(<InAppMessageToast />);
    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
