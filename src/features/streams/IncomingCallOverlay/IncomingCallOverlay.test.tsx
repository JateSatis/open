import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Vibration } from 'react-native';

import { IncomingCallOverlay } from './index';

import type { ChatSummary, IncomingCall } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { useSession } from '@/features/auth/useSession';
import { ensureCallMicrophone } from '@/features/streams/callPermissions';
import { joinCall } from '@/features/streams/callSession';
import { ring, resetRinging, useIncomingCall } from '@/features/streams/incomingCall';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
  router: { push: jest.fn() },
}));
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    loop: false,
  })),
}));
jest.mock('@/api/streams');
jest.mock('@/api/chats', () => ({}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/features/streams/callSession', () => ({ joinCall: jest.fn(() => Promise.resolve()) }));
jest.mock('@/features/streams/callPermissions', () => ({
  ensureCallMicrophone: jest.fn(() => Promise.resolve(true)),
  askNotificationsOnce: jest.fn(),
}));

const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

function incoming(overrides: Partial<IncomingCall> = {}): IncomingCall {
  return {
    streamId: 'stream-1',
    chatId: 'chat-1',
    chatTitle: 'Поход',
    chatKind: 'group',
    hostId: 'user-2',
    hostName: 'Марина',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRinging();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => undefined);
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
});

it('молчит, пока никто не звонит', async () => {
  await renderWithQuery(<IncomingCallOverlay />);

  expect(screen.queryByTestId('incoming-call')).toBeNull();
});

it('показывает чат, кто звонит, и честно говорит, что звонок публичный', async () => {
  await renderWithQuery(<IncomingCallOverlay />);
  await act(async () => ring(incoming()));

  expect(screen.getByText('Поход')).toBeTruthy();
  expect(screen.getByText('Марина звонит')).toBeTruthy();
  expect(screen.getByText('В эфире: вас услышат слушатели')).toBeTruthy();
  expect(Vibration.vibrate).toHaveBeenCalled();
});

it('«Отклонить» гасит звонок у меня — и только у меня: повторно он не зазвонит', async () => {
  await renderWithQuery(<IncomingCallOverlay />);
  await act(async () => ring(incoming()));

  fireEvent.press(screen.getByRole('button', { name: 'Отклонить' }));

  await waitFor(() => expect(screen.queryByTestId('incoming-call')).toBeNull());
  expect(joinCall).not.toHaveBeenCalled();
  expect(Vibration.cancel).toHaveBeenCalled();

  // То же событие ещё раз (переподключение канала) — отклонённый не звонит.
  await act(async () => ring(incoming()));
  expect(screen.queryByTestId('incoming-call')).toBeNull();
});

it('«Присоединиться» входит в звонок говорящим — с микрофоном', async () => {
  await renderWithQuery(<IncomingCallOverlay />);
  await act(async () => ring(incoming()));

  fireEvent.press(screen.getByRole('button', { name: 'Присоединиться' }));

  await waitFor(() => expect(joinCall).toHaveBeenCalled());
  expect(ensureCallMicrophone).toHaveBeenCalled();
  expect(joinCall).toHaveBeenCalledWith({
    streamId: 'stream-1',
    chatId: 'chat-1',
    chatTitle: 'Поход',
    isDirect: false,
  });
  expect(mockPush).toHaveBeenCalledWith('/call');
  expect(useIncomingCall.getState().ringing).toBeNull();
});

it('личный диалог называется по человеку', async () => {
  await renderWithQuery(<IncomingCallOverlay />);
  await act(async () => ring(incoming({ chatKind: 'direct', chatTitle: null })));

  expect(screen.getByText('Марина')).toBeTruthy();
  expect(screen.getByText('Звонит вам')).toBeTruthy();
});

it('звонок в группе показывает фото группы из списка чатов', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  queryClient.setQueryData<Partial<ChatSummary>[]>(chatsQueryKey, [
    {
      id: 'chat-1',
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
      <IncomingCallOverlay />
    </QueryClientProvider>,
  );
  await act(async () => ring(incoming()));

  // Фото подписано названием группы; буквы на его месте нет.
  expect(screen.getByLabelText('Поход')).toBeTruthy();
  expect(screen.queryByText('П')).toBeNull();
  queryClient.clear();
});
