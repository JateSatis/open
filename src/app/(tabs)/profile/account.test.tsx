import { screen, userEvent, waitFor } from '@testing-library/react-native';

import AccountScreen from './account';

import {
  deleteMyAccount,
  endDeviceSession,
  endOtherSessions,
  linkIdentity,
  listIdentities,
  listMyDevices,
  markDeviceSignedOut,
  signOutLocally,
  unlinkIdentity,
  type Device,
} from '@/api/account';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import { requestGoogleIdToken, signOutOfGoogle } from '@/features/auth/signIn';
import { useAppleSignInAvailable } from '@/features/auth/useAppleSignInAvailable';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/account', () => ({
  listIdentities: jest.fn(),
  listMyDevices: jest.fn(),
  linkIdentity: jest.fn(),
  unlinkIdentity: jest.fn(),
  endDeviceSession: jest.fn(),
  endOtherSessions: jest.fn(),
  deleteMyAccount: jest.fn(),
  markDeviceSignedOut: jest.fn(),
  signOutLocally: jest.fn(),
}));

jest.mock('@/features/auth/signIn', () => ({
  requestGoogleIdToken: jest.fn(),
  requestAppleIdToken: jest.fn(),
  signOutOfGoogle: jest.fn(),
}));

jest.mock('@/features/auth/useAppleSignInAvailable', () => ({
  useAppleSignInAvailable: jest.fn(),
}));

jest.mock('@/features/auth/installationId', () => ({
  getInstallationId: () => Promise.resolve('install-mine'),
}));

const mocked = {
  listIdentities: listIdentities as jest.Mock,
  listMyDevices: listMyDevices as jest.Mock,
  linkIdentity: linkIdentity as jest.Mock,
  unlinkIdentity: unlinkIdentity as jest.Mock,
  endDeviceSession: endDeviceSession as jest.Mock,
  endOtherSessions: endOtherSessions as jest.Mock,
  deleteMyAccount: deleteMyAccount as jest.Mock,
  markDeviceSignedOut: markDeviceSignedOut as jest.Mock,
  signOutLocally: signOutLocally as jest.Mock,
  requestGoogleIdToken: requestGoogleIdToken as jest.Mock,
  signOutOfGoogle: signOutOfGoogle as jest.Mock,
  useAppleSignInAvailable: useAppleSignInAvailable as jest.Mock,
};

const now = new Date().toISOString();

const devices: Device[] = [
  {
    id: 'dev-emulator',
    installationId: 'install-other',
    platform: 'android',
    model: 'Google sdk_gphone64',
    osVersion: '16',
    appVersion: '1.0.0',
    lastSeenAt: now,
  },
  {
    id: 'dev-phone',
    installationId: 'install-mine',
    platform: 'android',
    model: 'realme RMX3840',
    osVersion: '15',
    appVersion: '1.0.0',
    lastSeenAt: now,
  },
];

function renderAccount() {
  return renderWithQuery(
    <>
      <AccountScreen />
      <ConfirmDialogHost />
    </>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetConfirmDialogQueue();
  mocked.listIdentities.mockResolvedValue([
    { id: 'id-google', provider: 'google', email: 'max@gmail.com' },
  ]);
  mocked.listMyDevices.mockResolvedValue(devices);
  mocked.useAppleSignInAvailable.mockReturnValue(false);
  mocked.markDeviceSignedOut.mockResolvedValue(undefined);
  mocked.signOutLocally.mockResolvedValue(undefined);
  mocked.signOutOfGoogle.mockResolvedValue(undefined);
  mocked.deleteMyAccount.mockResolvedValue(undefined);
});

describe('AccountScreen — способы входа', () => {
  it('shows the provider and its e-mail, and never offers to unlink the last one', async () => {
    await renderAccount();

    expect(await screen.findByText('max@gmail.com')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.queryByText('Отвязать')).toBeNull();
  });

  it('does not offer Apple on Android', async () => {
    await renderAccount();
    await screen.findByText('max@gmail.com');

    expect(screen.queryByText('Привязать Apple')).toBeNull();
    expect(screen.queryByText('Привязать Google')).toBeNull();
  });

  it('links Google with the id token from the native sheet', async () => {
    mocked.useAppleSignInAvailable.mockReturnValue(true);
    mocked.listIdentities.mockResolvedValue([
      { id: 'id-apple', provider: 'apple', email: null },
    ]);
    mocked.requestGoogleIdToken.mockResolvedValue({ status: 'token', token: 'google-token' });
    mocked.linkIdentity.mockResolvedValue(undefined);
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Привязать Google'));

    await waitFor(() => expect(mocked.linkIdentity).toHaveBeenCalledWith('google', 'google-token'));
  });

  it('explains a Google account that already belongs to someone else', async () => {
    mocked.listIdentities.mockResolvedValue([{ id: 'id-apple', provider: 'apple', email: null }]);
    mocked.requestGoogleIdToken.mockResolvedValue({ status: 'token', token: 'google-token' });
    mocked.linkIdentity.mockRejectedValue(
      Object.assign(new Error('Identity is already linked'), { code: 'identity_already_exists' }),
    );
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Привязать Google'));

    expect(
      await screen.findByText('Этот аккаунт Google уже связан с другим профилем Open.'),
    ).toBeTruthy();
  });

  it('shows nothing when the user closes the Google sheet', async () => {
    mocked.listIdentities.mockResolvedValue([{ id: 'id-apple', provider: 'apple', email: null }]);
    mocked.requestGoogleIdToken.mockResolvedValue({ status: 'cancelled' });
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Привязать Google'));

    await waitFor(() => expect(mocked.requestGoogleIdToken).toHaveBeenCalled());
    expect(mocked.linkIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText(/Не удалось/)).toBeNull();
  });

  it('unlinks one of two providers after confirmation', async () => {
    mocked.listIdentities.mockResolvedValue([
      { id: 'id-google', provider: 'google', email: 'max@gmail.com' },
      { id: 'id-apple', provider: 'apple', email: null },
    ]);
    mocked.unlinkIdentity.mockResolvedValue(undefined);
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByLabelText('Отвязать Apple'));
    expect(await screen.findByText('Отвязать Apple?')).toBeTruthy();
    await user.press(screen.getAllByText('Отвязать').at(-1) as never);

    await waitFor(() => expect(mocked.unlinkIdentity).toHaveBeenCalledWith('id-apple'));
  });
});

describe('AccountScreen — устройства', () => {
  it('lists the current device first and without an end button', async () => {
    await renderAccount();

    await screen.findByText('realme RMX3840');
    const titles = screen
      .getAllByText(/realme RMX3840|Google sdk_gphone64/)
      .map((node) => node.props.children);

    expect(titles).toEqual(['realme RMX3840', 'Google sdk_gphone64']);
    expect(screen.getByText(/Это устройство/)).toBeTruthy();
    expect(screen.queryByLabelText('Завершить сеанс: realme RMX3840')).toBeNull();
    expect(screen.getByLabelText('Завершить сеанс: Google sdk_gphone64')).toBeTruthy();
  });

  it('ends another device session only after confirmation', async () => {
    mocked.endDeviceSession.mockResolvedValue(undefined);
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByLabelText('Завершить сеанс: Google sdk_gphone64'));
    expect(await screen.findByText('Завершить сеанс?')).toBeTruthy();
    expect(mocked.endDeviceSession).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Завершить' }));

    await waitFor(() => expect(mocked.endDeviceSession.mock.calls[0]?.[0]).toBe('dev-emulator'));
  });

  it('ends every other session', async () => {
    mocked.endOtherSessions.mockResolvedValue(undefined);
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Завершить все, кроме этого'));
    await user.press(await screen.findByRole('button', { name: 'Завершить все' }));

    await waitFor(() => expect(mocked.endOtherSessions).toHaveBeenCalled());
  });

  it('hides «end all» when this is the only device', async () => {
    mocked.listMyDevices.mockResolvedValue([devices[1]]);

    await renderAccount();
    await screen.findByText('realme RMX3840');

    expect(screen.queryByText('Завершить все, кроме этого')).toBeNull();
  });
});

describe('AccountScreen — выход и удаление', () => {
  it('signs out of this device only, forgetting the Google account choice', async () => {
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Выйти из аккаунта'));
    expect(await screen.findByText('Вы выйдете только на этом устройстве. На остальных вход сохранится.')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(mocked.signOutLocally).toHaveBeenCalled());
    expect(mocked.markDeviceSignedOut).toHaveBeenCalledWith('install-mine');
    expect(mocked.signOutOfGoogle).toHaveBeenCalled();
  });

  it('does nothing when sign-out is cancelled', async () => {
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Выйти из аккаунта'));
    await user.press(await screen.findByRole('button', { name: 'Отмена' }));

    expect(mocked.signOutLocally).not.toHaveBeenCalled();
  });

  it('warns honestly that messages stay public before deleting the account', async () => {
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Удалить аккаунт'));

    expect(await screen.findByText('Удалить аккаунт?')).toBeTruthy();
    expect(screen.getByText(/останутся в чатах за подписью «Удалённый аккаунт»/)).toBeTruthy();

    await user.press(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(mocked.deleteMyAccount).toHaveBeenCalled());
    await waitFor(() => expect(mocked.signOutLocally).toHaveBeenCalled());
  });

  it('keeps the user signed in when deletion fails', async () => {
    mocked.deleteMyAccount.mockRejectedValue(new Error('500'));
    const user = userEvent.setup();

    await renderAccount();
    await user.press(await screen.findByText('Удалить аккаунт'));
    await user.press(await screen.findByRole('button', { name: 'Удалить' }));

    expect(
      await screen.findByText('Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(mocked.signOutLocally).not.toHaveBeenCalled();
  });
});
