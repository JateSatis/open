import { requestClient } from '@/api/requestClient';
import { screen, userEvent, waitFor, within } from '@testing-library/react-native';

import { PrivacyScreen } from '@/features/privacy/PrivacyScreen';

import { getMyPrivacySettings, setPrivacySetting, type PrivacySettings } from '@/api/privacy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { renderWithQuery } from '@/test/renderWithQuery';
import { Colors } from '@/theme';

const mockPush = jest.fn();

jest.mock('@/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
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

const TEEN: PrivacySettings = {
  birthDate: '2010-05-01',
  friendsListVisibility: 'nobody',
  activityStatusVisibility: 'friends',
  messageTimeVisibility: 'friends',
  searchVisibility: 'friends',
  identityVisibility: 'friends',
  dialogueNameVisibility: 'friends',
  avatarVisibility: 'friends',
  mediaVisibility: 'friends',
  identityAlias: 'Илья Муромцев',
  publicDelay: 'random_delay',
};

const ADULT: PrivacySettings = {
  birthDate: '1990-05-01',
  friendsListVisibility: 'everyone',
  activityStatusVisibility: 'everyone',
  messageTimeVisibility: 'everyone',
  searchVisibility: 'everyone',
  identityVisibility: 'everyone',
  dialogueNameVisibility: 'everyone',
  avatarVisibility: 'everyone',
  mediaVisibility: 'everyone',
  identityAlias: 'Вера Соколова',
  publicDelay: 'off',
};

const TITLES = {
  activity: 'Кто видит, что я в сети',
  time: 'Кто видит время сообщений и прочтение',
  search: 'Кто может найти меня в поиске',
  friends: 'Кто видит список друзей',
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.useColorScheme.mockReturnValue('light');
});

describe('Конфиденциальность и безопасность', () => {
  it.each([
    ['подросток', TEEN, 'Только друзья'],
    ['взрослый', ADULT, 'Все'],
  ])('К5.1 %s видит текущее значение трёх настроек этапа', async (_who, value, label) => {
    mocked.getMyPrivacySettings.mockResolvedValue(value);

    await renderWithQuery(<PrivacyScreen />);

    expect(await screen.findByText(TITLES.activity)).toBeTruthy();
    for (const title of [TITLES.activity, TITLES.time, TITLES.search]) {
      expect(screen.getByLabelText(`${title}: ${label}, выбрано`)).toBeTruthy();
    }
  });

  it('группы «Активность» и «Поиск и контакты», список друзей — на месте', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(TEEN);

    await renderWithQuery(<PrivacyScreen />);

    expect(await screen.findByText('Активность')).toBeTruthy();
    expect(screen.getByText('Поиск и контакты')).toBeTruthy();
    expect(screen.getByLabelText(`${TITLES.friends}: Никто, выбрано`)).toBeTruthy();
    // Этап 5: сервер применяет настройку медиа — группа на месте.
    expect(screen.getByText('Контент и данные')).toBeTruthy();
  });

  it.each([
    ['privacy-activity-status', 'activity_status_visibility', TITLES.activity],
    ['privacy-message-time', 'message_activity_metadata_visibility', TITLES.time],
    ['privacy-search', 'account_search_visibility', TITLES.search],
    ['privacy-friends-list', 'friends_list_visibility', TITLES.friends],
  ])('К5.2 %s: выбор сохраняется на сервере и сразу отмечен', async (testID, key, title) => {
    let current = ADULT;
    mocked.getMyPrivacySettings.mockImplementation(() => Promise.resolve(current));
    mocked.setPrivacySetting.mockImplementation((setting: string, value: string) => {
      current = {
        ...current,
        ...(setting === 'activity_status_visibility' ? { activityStatusVisibility: value } : {}),
        ...(setting === 'message_activity_metadata_visibility'
          ? { messageTimeVisibility: value }
          : {}),
        ...(setting === 'account_search_visibility' ? { searchVisibility: value } : {}),
        ...(setting === 'friends_list_visibility' ? { friendsListVisibility: value } : {}),
      } as PrivacySettings;

      return Promise.resolve();
    });
    const user = userEvent.setup();

    await renderWithQuery(<PrivacyScreen />);
    await user.press(await screen.findByTestId(`${testID}-nobody`));

    expect(mocked.setPrivacySetting).toHaveBeenCalledWith(key, 'nobody', requestClient());
    expect(await screen.findByLabelText(`${title}: Никто, выбрано`)).toBeTruthy();
  });

  it('сервер не принял — значение откатывается, понятный текст', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(TEEN);
    mocked.setPrivacySetting.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();

    await renderWithQuery(<PrivacyScreen />);
    await user.press(await screen.findByTestId('privacy-message-time-everyone'));

    expect(
      await screen.findByText(
        'Не удалось сохранить настройку. Проверьте интернет и попробуйте ещё раз.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText(`${TITLES.time}: Только друзья, выбрано`)).toBeTruthy(),
    );
  });

  it('пояснения говорят, что скрыто, и не обещают анонимности', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(TEEN);

    await renderWithQuery(<PrivacyScreen />);

    expect(await screen.findByText(/во всех диалогах, где вы участвуете/)).toBeTruthy();
    expect(
      screen.getByText(/Вы тоже не увидите прочтение у тех, от кого скрыли время/),
    ).toBeTruthy();
    expect(screen.getByText(/Сам текст переписки остаётся публичным/)).toBeTruthy();
    expect(screen.getByText(/Звонки остаются публичными/)).toBeTruthy();
    expect(screen.queryByText(/никогда|анонимн|гарант/i)).toBeNull();
  });

  it.each(['light', 'dark'] as const)('К5.3 цвета темы %s — из src/theme', async (scheme) => {
    mocked.useColorScheme.mockReturnValue(scheme);
    mocked.getMyPrivacySettings.mockResolvedValue(TEEN);

    await renderWithQuery(<PrivacyScreen />);

    const activity = await screen.findByTestId('privacy-activity-status-friends');

    expect(within(activity).getByText('Только друзья')).toHaveStyle({ color: Colors[scheme].text });
    expect(screen.getByText(TITLES.activity)).toHaveStyle({ color: Colors[scheme].textSecondary });
    expect(screen.getByText('Активность')).toHaveStyle({ color: Colors[scheme].text });
  });

  it('К5.1 «Заблокированные» ведёт к списку; «Заявок на диалог» как настройки нет', async () => {
    mocked.getMyPrivacySettings.mockResolvedValue(ADULT);
    const user = userEvent.setup();

    await renderWithQuery(<PrivacyScreen />);
    await user.press(await screen.findByTestId('privacy-blocked'));

    expect(mockPush).toHaveBeenCalledWith({ name: 'Blocked' });
    expect(screen.getByText(/могут прислать заявку — одно сообщение без медиа/)).toBeTruthy();
    expect(screen.queryByText('Заявки на диалог')).toBeNull();
  });
});
