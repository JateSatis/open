import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';

import { AppRoutes } from '@/navigation/routes/AppRoutes';

import { deleteMyAccount, signOutLocally } from '@/api/account';
import {
  BirthDateInFutureError,
  BirthDateTooYoungError,
  getMyPrivacySettings,
  setBirthDate,
} from '@/api/privacy';
import { useSession } from '@/features/auth/useSession';
import { readLocalBirthDate } from '@/features/privacy/localBirthDate';
import { renderWithQuery } from '@/test/renderWithQuery';

// Этот тест монтирует только экраны входа, даты и вкладок.
jest.mock('@/navigation/routes/ChatsRoutes', () => ({ chatsRoutes: null }));
jest.mock('@/navigation/routes/FeedRoutes', () => ({ feedRoutes: null }));
jest.mock('@/navigation/routes/ProfileRoutes', () => ({ profileRoutes: null }));
jest.mock('@/features/streams/CallScreen', () => ({ CallScreen: () => null }));
jest.mock('@/features/media/MediaLabScreen', () => ({ MediaLabScreen: () => null }));
jest.mock('@/features/chats/MosaicLabScreen', () => ({ MosaicLabScreen: () => null }));
jest.mock('@/features/auth/SignInScreen', () => {
  const { Text } = require('react-native');
  return { SignInScreen: () => <Text>Вход</Text> };
});
jest.mock('@/features/feed/FeedScreen', () => ({ FeedScreen: () => null }));
jest.mock('@/features/profile/MyProfileScreen', () => ({ MyProfileScreen: () => null }));
jest.mock('@/features/chats/ChatsScreen', () => {
  const { Text } = require('react-native');
  return { ChatsScreen: () => <Text>Чаты</Text> };
});

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/privacy', () => ({
  ...jest.requireActual('@/api/privacy'),
  getMyPrivacySettings: jest.fn(),
  setBirthDate: jest.fn(),
}));
jest.mock('@/api/account', () => ({
  ...jest.requireActual('@/api/account'),
  deleteMyAccount: jest.fn(),
  signOutLocally: jest.fn(),
}));
jest.mock('@/features/auth/signIn', () => ({ signOutOfGoogle: jest.fn() }));
jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
  useAuthBootstrap: () => ({
    localAccountId: mocked.useSession().session?.user.id ?? null,
    sdkStatus: mocked.useSession().session ? 'session' : 'signedOut',
  }),
}));

declare global {
  // Какой день отдаёт подменённый нативный выбор даты (src/test/jest.setup.js).
  var mockPickerDate: Date | undefined;
}

const mocked = {
  getMyPrivacySettings: getMyPrivacySettings as jest.Mock,
  setBirthDate: setBirthDate as jest.Mock,
  deleteMyAccount: deleteMyAccount as jest.Mock,
  signOutLocally: signOutLocally as jest.Mock,
  useSession: useSession as jest.Mock,
};

const signedIn = { session: { user: { id: 'new-user' } }, isAuthenticated: true, isLoading: false };

/** День, когда человеку исполнилось бы `years`, — полдень, как отдаёт выбор на iOS. */
function yearsAgo(years: number): Date {
  const now = new Date();

  return new Date(now.getFullYear() - years, now.getMonth(), now.getDate() - 10, 12);
}

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Сервер принимает дату — и следующий запрос настроек её уже видит. */
function serverAcceptsDate() {
  mocked.setBirthDate.mockImplementation((date: string) => {
    mocked.getMyPrivacySettings.mockResolvedValue({
      birthDate: date,
      friendsListVisibility: 'nobody',
    });

    return Promise.resolve();
  });
}

async function pickAndContinue(date: Date) {
  const user = userEvent.setup();
  globalThis.mockPickerDate = date;

  await user.press(await screen.findByTestId('birth-date-field'));
  await user.press(screen.getByTestId('birth-date-picker-pick'));
  await user.press(screen.getByText('Продолжить'));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mocked.useSession.mockReturnValue(signedIn);
  mocked.getMyPrivacySettings.mockResolvedValue({
    birthDate: null,
    friendsListVisibility: 'nobody',
  });
  mocked.signOutLocally.mockResolvedValue(undefined);
  globalThis.mockPickerDate = undefined;
});

describe('ворота даты рождения', () => {
  it('К2.1 без даты вкладки не показываются — вместо них экран даты', async () => {
    await renderWithQuery(<AppRoutes />);

    expect(await screen.findByText('Дата рождения')).toBeTruthy();
    expect(screen.queryByText('Чаты')).toBeNull();
  });

  it('К2.1 холодный старт без даты и сети ведёт на экран даты', async () => {
    mocked.getMyPrivacySettings.mockRejectedValue(new Error('offline'));
    await renderWithQuery(<AppRoutes />);

    expect(await screen.findByText('Дата рождения')).toBeTruthy();
  });

  it('пока ответа нет, вкладки не мелькают', async () => {
    mocked.getMyPrivacySettings.mockReturnValue(new Promise(() => {}));

    await renderWithQuery(<AppRoutes />);

    expect(screen.queryByText('Чаты')).toBeNull();
  });

  it('К2.5 с датой — сразу вкладки, экран даты не показывается', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue({
      birthDate: '2000-01-01',
      friendsListVisibility: 'everyone',
    });

    await renderWithQuery(<AppRoutes />);
    expect(await screen.findByText('Чаты')).toBeTruthy();
  });

  it('К2.5 старая отметка работает офлайн, фактическая дата восстанавливается после обновления', async () => {
    await AsyncStorage.setItem('privacy.birthDateKnown.new-user', '1');
    mocked.getMyPrivacySettings.mockRejectedValue(new Error('offline'));
    const legacy = await renderWithQuery(<AppRoutes />);
    expect(await screen.findByText('Чаты')).toBeTruthy();
    expect(await readLocalBirthDate('new-user')).toBe('legacy');
    await legacy.unmount();
    mocked.getMyPrivacySettings.mockResolvedValue({ birthDate: '2000-01-01' });
    const online = await renderWithQuery(<AppRoutes />);
    await waitFor(async () =>
      expect(await readLocalBirthDate('new-user')).toEqual({ date: '2000-01-01' }),
    );
    await online.unmount();
    mocked.getMyPrivacySettings.mockRejectedValue(new Error('offline'));
    await renderWithQuery(<AppRoutes />);
    expect(await screen.findByText('Чаты')).toBeTruthy();
  });

  it('не вошёл — экран даты ведёт ко входу', async () => {
    mocked.useSession.mockReturnValue({ session: null, isAuthenticated: false, isLoading: false });

    await renderWithQuery(<AppRoutes />);

    expect(await screen.findByText('Вход')).toBeTruthy();
  });

  it('ответ настроек после смены аккаунта обновляет только начавший запрос ID', async () => {
    let finish!: (value: { birthDate: string }) => void;
    mocked.getMyPrivacySettings.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const app = await renderWithQuery(<AppRoutes />);
    await waitFor(() => expect(mocked.getMyPrivacySettings).toHaveBeenCalledTimes(1));
    mocked.useSession.mockReturnValue({ ...signedIn, session: { user: { id: 'other' } } });
    await app.rerender(<AppRoutes />);
    expect(await screen.findByTestId('birth-date-field')).toBeTruthy();
    await act(async () => finish({ birthDate: '2000-04-10' }));
    expect(await readLocalBirthDate('new-user')).toEqual({ date: '2000-04-10' });
    expect(await readLocalBirthDate('other')).toBeNull();
    expect(screen.getByTestId('birth-date-field')).toBeTruthy();
  });
});

describe('экран даты рождения', () => {
  it('говорит, что дату не видит никто, и без даты дальше не пускает', async () => {
    await renderWithQuery(<AppRoutes />);

    expect(await screen.findByText('Дата рождения')).toBeTruthy();
    expect(screen.getByText(/Дату рождения не видит никто, кроме вас/)).toBeTruthy();
    await userEvent.setup().press(screen.getByText('Продолжить'));
    expect(mocked.setBirthDate).not.toHaveBeenCalled();
  });

  it.each([
    ['18+', 25],
    ['13–17', 15],
  ])('К2.2 дата %s — во вкладки «Чаты»', async (_label, years) => {
    serverAcceptsDate();
    await renderWithQuery(<AppRoutes />);

    await pickAndContinue(yearsAgo(years));

    await waitFor(() =>
      expect(mocked.setBirthDate).toHaveBeenCalledWith(dateOnly(yearsAgo(years))),
    );
    expect(await screen.findByText('Чаты')).toBeTruthy();
  });

  it('К2.3 12 лет — отказ; «Изменить дату» возвращает к полю, 14 лет пускает', async () => {
    mocked.setBirthDate.mockRejectedValueOnce(new BirthDateTooYoungError());
    const initial = await renderWithQuery(<AppRoutes />);

    await pickAndContinue(yearsAgo(12));

    expect(await screen.findByText('Регистрация в Open возможна с 13 лет')).toBeTruthy();
    await initial.unmount();
    // Новый QueryClient и состояние формы. Сервер по-прежнему отдаёт пустую дату.
    const restored = await renderWithQuery(<AppRoutes />);
    expect(await screen.findByText('Регистрация в Open возможна с 13 лет')).toBeTruthy();
    expect(screen.getByText('Выйти')).toBeTruthy();

    serverAcceptsDate();
    await userEvent.setup().press(screen.getByText('Изменить дату'));
    expect(await screen.findByTestId('birth-date-field')).toBeTruthy();

    await pickAndContinue(yearsAgo(14));

    expect(await screen.findByText('Чаты')).toBeTruthy();
    await restored.unmount();
    mocked.getMyPrivacySettings.mockRejectedValue(new Error('offline'));
    await renderWithQuery(<AppRoutes />);
    expect(await screen.findByText('Чаты')).toBeTruthy();
    expect(await readLocalBirthDate('new-user')).toEqual({ date: dateOnly(yearsAgo(14)) });
  });

  it('К2.4 «Выйти» на отказе удаляет аккаунт и выходит', async () => {
    mocked.setBirthDate.mockRejectedValue(new BirthDateTooYoungError());
    mocked.deleteMyAccount.mockResolvedValue(undefined);
    await renderWithQuery(<AppRoutes />);

    await pickAndContinue(yearsAgo(12));
    await userEvent.setup().press(await screen.findByText('Выйти'));

    await waitFor(() => expect(mocked.deleteMyAccount).toHaveBeenCalled());
    await waitFor(() => expect(mocked.signOutLocally).toHaveBeenCalled());
  });

  it('при расхождении часов форма принимает решение сервера в обе стороны', async () => {
    mocked.setBirthDate.mockRejectedValueOnce(new BirthDateTooYoungError());
    await renderWithQuery(<AppRoutes />);
    await pickAndContinue(yearsAgo(13));
    expect(await screen.findByText('Регистрация в Open возможна с 13 лет')).toBeTruthy();
    expect(screen.queryByText('Чаты')).toBeNull();

    await userEvent.setup().press(screen.getByText('Изменить дату'));
    serverAcceptsDate();
    await pickAndContinue(yearsAgo(12));
    expect(await screen.findByText('Чаты')).toBeTruthy();
  });

  it('удаление не прошло — понятный текст, аккаунт не брошен молча', async () => {
    mocked.setBirthDate.mockRejectedValue(new BirthDateTooYoungError());
    mocked.deleteMyAccount.mockRejectedValue(new Error('offline'));
    await renderWithQuery(<AppRoutes />);

    await pickAndContinue(yearsAgo(12));
    await userEvent.setup().press(await screen.findByText('Выйти'));

    expect(
      await screen.findByText(
        'Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.',
      ),
    ).toBeTruthy();
    expect(mocked.signOutLocally).not.toHaveBeenCalled();
  });

  it('сбой сохранения — понятный текст, а не сырой ответ', async () => {
    mocked.setBirthDate.mockRejectedValue(new Error('PGRST'));
    await renderWithQuery(<AppRoutes />);

    await pickAndContinue(yearsAgo(20));

    expect(
      await screen.findByText(
        'Не удалось сохранить дату. Проверьте интернет и попробуйте ещё раз.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/PGRST/)).toBeNull();
    expect(await readLocalBirthDate('new-user')).toBeNull();
  });

  it('OPN03 оставляет первичный ввод доступным после перезапуска', async () => {
    mocked.setBirthDate.mockRejectedValue(new BirthDateInFutureError());
    const initial = await renderWithQuery(<AppRoutes />);
    await pickAndContinue(yearsAgo(-1));
    expect(await screen.findByText(/не может быть в будущем/)).toBeTruthy();
    await initial.unmount();
    await renderWithQuery(<AppRoutes />);
    expect(await screen.findByTestId('birth-date-field')).toBeTruthy();
    expect(await readLocalBirthDate('new-user')).toBeNull();
  });

  it('ответ на сохранение после смены аккаунта попадает к исходному пользователю', async () => {
    let accept!: () => void;
    mocked.setBirthDate.mockReturnValue(
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
    );
    const app = await renderWithQuery(<AppRoutes />);
    await pickAndContinue(yearsAgo(20));
    mocked.useSession.mockReturnValue({ ...signedIn, session: { user: { id: 'other' } } });
    await app.rerender(<AppRoutes />);
    await act(async () => accept());
    await waitFor(async () =>
      expect(await readLocalBirthDate('new-user')).toEqual({ date: dateOnly(yearsAgo(20)) }),
    );
    expect(await readLocalBirthDate('other')).toBeNull();
    expect(await screen.findByTestId('birth-date-field')).toBeTruthy();
  });
});
