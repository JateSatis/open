import { screen, userEvent, waitFor } from '@testing-library/react-native';

import PrivacyRoute from './privacy';

import { getMyPrivacySettings, setPrivacySetting } from '@/api/privacy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { renderWithQuery } from '@/test/renderWithQuery';
import { Colors } from '@/theme';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/friends', () => ({}));
jest.mock('@/api/privacy', () => ({
  ...jest.requireActual('@/api/privacy'),
  getMyPrivacySettings: jest.fn(),
  setPrivacySetting: jest.fn(),
}));
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, isAuthenticated: true, isLoading: false }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn() }));

const mocked = {
  getMyPrivacySettings: getMyPrivacySettings as jest.Mock,
  setPrivacySetting: setPrivacySetting as jest.Mock,
  useColorScheme: useColorScheme as jest.Mock,
};

function settings(friendsListVisibility: string) {
  return { birthDate: '2010-05-01', friendsListVisibility };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.useColorScheme.mockReturnValue('light');
});

describe('Конфиденциальность и безопасность', () => {
  it.each([
    ['подросток', 'nobody', 'Никто'],
    ['взрослый', 'everyone', 'Все'],
  ])('К5.1 %s видит текущее значение списка друзей', async (_who, value, label) => {
    mocked.getMyPrivacySettings.mockResolvedValue(settings(value));

    await renderWithQuery(<PrivacyRoute />);

    expect(await screen.findByText('Кто видит список друзей')).toBeTruthy();
    expect(screen.getByLabelText(`Кто видит список друзей: ${label}, выбрано`)).toBeTruthy();
  });

  it('пока работает одна настройка — других групп нет, заглушек нет', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(settings('nobody'));

    await renderWithQuery(<PrivacyRoute />);
    await screen.findByText('Кто видит список друзей');

    expect(screen.queryByText(/Идентичность|Активность|Поиск и контакты/i)).toBeNull();
  });

  it('К5.2 выбор сохраняется на сервере и сразу отмечен', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(settings('nobody'));
    mocked.setPrivacySetting.mockImplementation(() => {
      mocked.getMyPrivacySettings.mockResolvedValue(settings('friends'));

      return Promise.resolve();
    });
    const user = userEvent.setup();

    await renderWithQuery(<PrivacyRoute />);
    await user.press(await screen.findByText('Только друзья'));

    expect(mocked.setPrivacySetting).toHaveBeenCalledWith('friends_list_visibility', 'friends');
    expect(
      await screen.findByLabelText('Кто видит список друзей: Только друзья, выбрано'),
    ).toBeTruthy();
  });

  it('сервер не принял — значение откатывается, понятный текст', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(settings('nobody'));
    mocked.setPrivacySetting.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();

    await renderWithQuery(<PrivacyRoute />);
    await user.press(await screen.findByText('Все'));

    expect(
      await screen.findByText(
        'Не удалось сохранить настройку. Проверьте интернет и попробуйте ещё раз.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText('Кто видит список друзей: Никто, выбрано')).toBeTruthy(),
    );
  });

  it('формулировка без обещаний: «скрывает от…», а не «никто никогда»', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(settings('nobody'));

    await renderWithQuery(<PrivacyRoute />);

    expect(await screen.findByText(/^Скрывает строку «Друзья»/)).toBeTruthy();
    expect(screen.queryByText(/никогда|анонимн|гарант/i)).toBeNull();
  });

  it.each(['light', 'dark'] as const)('К5.7 цвета темы %s — из src/theme', async (scheme) => {
    mocked.useColorScheme.mockReturnValue(scheme);
    mocked.getMyPrivacySettings.mockResolvedValue(settings('nobody'));

    await renderWithQuery(<PrivacyRoute />);

    expect(await screen.findByText('Только друзья')).toHaveStyle({
      color: Colors[scheme].text,
    });
    expect(screen.getByText('Кто видит список друзей')).toHaveStyle({
      color: Colors[scheme].textSecondary,
    });
  });
});
