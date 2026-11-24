import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { requestClient } from '@/api/requestClient';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { setCall, patchCall, getCall, type ActiveCall } from '@/features/streams/callStore';
import { readChatDraft, setDraftText } from '@/features/chats/composerDraftStore';
import { sessionOf } from '@/test/sessionOf';
import { SavedAccounts } from './SavedAccounts';
import { addSession, getSelectedAccountId, selectAccount, subscribeToSession } from './sessionStore';
import { startAccountPresentation } from './accountPresentation';
import { withSessionChange } from './sessionChange';

jest.mock('./signIn', () => ({ signOutOfGoogle: jest.fn() }));
jest.mock('./useAppleSignInAvailable', () => ({ useAppleSignInAvailable: () => false }));
jest.mock('./installationId', () => ({ getInstallationId: async () => 'test-installation' }));
jest.mock('@/features/media/voicePlayback', () => ({ stopVoice: jest.fn() }));
jest.mock('@/features/media', () => ({ stopVoice: jest.fn() }));

function fixture(userId: string) {
  const session = sessionOf(userId, userId + '-device');
  return {
    ...session,
    user: { ...session.user, email: userId + '@example.test' },
    refresh_token: 'fixture-' + userId,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

it('меняет владельца через строки, защищает звонок и убирает отозванный аккаунт', async () => {
  const previous = global.fetch;
  global.fetch = jest.fn(async () => new Response(null, { status: 204 }));
  const stop = subscribeToSession();
  const close = startAccountPresentation();
  try {
    await addSession(fixture('B'));
    const clientB = requestClient();
    await addSession(fixture('A'));
    setDraftText('chat', 'Черновик A');
    const call = { streamId: 'call', joinedAt: 1 } as ActiveCall;
    setCall(call);
    await render(<><SavedAccounts manage /><ConfirmDialogHost /></>);
    const choose = (id: string) => fireEvent.press(screen.getByTestId('account-select-' + id));
    await choose('B');
    expect(await screen.findByText('Выйти из звонка и переключиться?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Отмена'));
    expect(getCall()).toBe(call);
    expect(getSelectedAccountId()).toBe('A');
    await choose('B');
    patchCall({ connection: 'connected', joinedAt: 2 });
    let finishRegistration!: () => void;
    const registration = withSessionChange(() => new Promise<void>(resolve => { finishRegistration = resolve; }));
    await fireEvent.press(await screen.findByText('Переключиться'));
    try {
      await waitFor(() => expect(getSelectedAccountId()).toBe('B'));
    } finally {
      finishRegistration();
      await registration;
    }
    expect(getCall()).toBeNull();
    expect(readChatDraft('chat').text).toBe('');
    await choose('A');
    await waitFor(() => expect(getSelectedAccountId()).toBe('A'));
    expect(readChatDraft('chat').text).toBe('Черновик A');

    await fireEvent.press(screen.getByLabelText('Выйти из B@example.test'));
    expect(await screen.findByText('Выйти из аккаунта?')).toBeTruthy();
    await act(() => selectAccount('B'));
    expect(screen.queryByText('Выйти из аккаунта?')).toBeNull();
    await choose('A');
    await waitFor(() => expect(getSelectedAccountId()).toBe('A'));
    await act(() => clientB.auth.signOut({ scope: 'local' }));
    await waitFor(() => expect(screen.queryByText('B@example.test')).toBeNull());
    expect(getSelectedAccountId()).toBe('A');
  } finally {
    close();
    stop();
    global.fetch = previous;
  }
});
