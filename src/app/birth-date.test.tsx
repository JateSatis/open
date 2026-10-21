import { screen, userEvent, waitFor } from '@testing-library/react-native';

import BirthDateRoute from './birth-date';
import Index from './index';
import TabsLayout from './(tabs)/_layout';

import { deleteMyAccount, signOutLocally } from '@/api/account';
import { BirthDateTooYoungError, getMyPrivacySettings, setBirthDate } from '@/api/privacy';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual('react-native');

  return {
    // Куда увела навигация — видно на экране текстом.
    Redirect: ({ href }: { href: string }) => <MockText>{`redirect:${href}`}</MockText>,
    Tabs: Object.assign(() => <MockText>вкладки</MockText>, { Screen: () => null }),
  };
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
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));

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

beforeEach(() => {
  jest.clearAllMocks();
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
    await renderWithQuery(<TabsLayout />);

    expect(await screen.findByText('redirect:/birth-date')).toBeTruthy();
    expect(screen.queryByText('вкладки')).toBeNull();
  });

  it('К2.1 холодный старт без даты ведёт на экран даты', async () => {
    await renderWithQuery(<Index />);

    expect(await screen.findByText('redirect:/birth-date')).toBeTruthy();
  });

  it('пока ответа нет, вкладки не мелькают', async () => {
    mocked.getMyPrivacySettings.mockReturnValue(new Promise(() => {}));

    await renderWithQuery(<TabsLayout />);

    expect(screen.queryByText('вкладки')).toBeNull();
  });

  it('К2.5 с датой — сразу вкладки, экран даты не показывается', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue({
      birthDate: '2000-01-01',
      friendsListVisibility: 'everyone',
    });

    await renderWithQuery(<TabsLayout />);
    expect(await screen.findByText('вкладки')).toBeTruthy();
  });

  it('К2.5 с датой экран даты сам уводит во вкладки', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue({
      birthDate: '2000-01-01',
      friendsListVisibility: 'everyone',
    });

    await renderWithQuery(<BirthDateRoute />);

    expect(await screen.findByText('redirect:/(tabs)/chats')).toBeTruthy();
  });

  it('не вошёл — экран даты ведёт ко входу', async () => {
    mocked.useSession.mockReturnValue({ session: null, isAuthenticated: false, isLoading: false });

    await renderWithQuery(<BirthDateRoute />);

    expect(await screen.findByText('redirect:/(auth)/sign-in')).toBeTruthy();
  });
});

describe('экран даты рождения', () => {
  it('говорит, что дату не видит никто, и без даты дальше не пускает', async () => {
    await renderWithQuery(<BirthDateRoute />);

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
    await renderWithQuery(<BirthDateRoute />);

    await pickAndContinue(yearsAgo(years));

    await waitFor(() => expect(mocked.setBirthDate).toHaveBeenCalledWith(dateOnly(yearsAgo(years))));
    expect(await screen.findByText('redirect:/(tabs)/chats')).toBeTruthy();
  });

  it('К2.3 12 лет — отказ; «Изменить дату» возвращает к полю, 14 лет пускает', async () => {
    mocked.setBirthDate.mockRejectedValueOnce(new BirthDateTooYoungError());
    await renderWithQuery(<BirthDateRoute />);

    await pickAndContinue(yearsAgo(12));

    expect(await screen.findByText('Регистрация в Open возможна с 13 лет')).toBeTruthy();
    expect(screen.getByText('Выйти')).toBeTruthy();

    serverAcceptsDate();
    await userEvent.setup().press(screen.getByText('Изменить дату'));
    expect(await screen.findByTestId('birth-date-field')).toBeTruthy();

    await pickAndContinue(yearsAgo(14));

    expect(await screen.findByText('redirect:/(tabs)/chats')).toBeTruthy();
  });

  it('К2.4 «Выйти» на отказе удаляет аккаунт и выходит', async () => {
    mocked.setBirthDate.mockRejectedValue(new BirthDateTooYoungError());
    mocked.deleteMyAccount.mockResolvedValue(undefined);
    await renderWithQuery(<BirthDateRoute />);

    await pickAndContinue(yearsAgo(12));
    await userEvent.setup().press(await screen.findByText('Выйти'));

    await waitFor(() => expect(mocked.deleteMyAccount).toHaveBeenCalled());
    await waitFor(() => expect(mocked.signOutLocally).toHaveBeenCalled());
  });

  it('удаление не прошло — понятный текст, аккаунт не брошен молча', async () => {
    mocked.setBirthDate.mockRejectedValue(new BirthDateTooYoungError());
    mocked.deleteMyAccount.mockRejectedValue(new Error('offline'));
    await renderWithQuery(<BirthDateRoute />);

    await pickAndContinue(yearsAgo(12));
    await userEvent.setup().press(await screen.findByText('Выйти'));

    expect(
      await screen.findByText('Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(mocked.signOutLocally).not.toHaveBeenCalled();
  });

  it('сбой сохранения — понятный текст, а не сырой ответ', async () => {
    mocked.setBirthDate.mockRejectedValue(new Error('PGRST'));
    await renderWithQuery(<BirthDateRoute />);

    await pickAndContinue(yearsAgo(20));

    expect(
      await screen.findByText('Не удалось сохранить дату. Проверьте интернет и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(screen.queryByText(/PGRST/)).toBeNull();
  });
});
