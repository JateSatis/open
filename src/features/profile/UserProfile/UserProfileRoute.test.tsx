import { requestClient } from '@/api/requestClient';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouteParams } from '@/navigation';

import { UserProfile } from '@/features/profile/UserProfile';

import {
  acceptFriendRequest,
  cancelFriendRequest,
  FriendRequestLimitError,
  getFriendsSummary,
  getFriendshipStatus,
  removeFriend,
  sendFriendRequest,
} from '@/api/friends';
import { blockUser, isBlockedByMe, reportUser } from '@/api/blocks';
import { getProfile } from '@/api/profile';
import { ProfileUnavailableError } from '@/api/profileErrors';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock('@/navigation', () => ({
  useIsFocused: () => true,
  ScreenOptions: () => null,
  useRouteParams: jest.fn(),
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/blocks', () => ({
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
  reportUser: jest.fn(),
  isBlockedByMe: jest.fn(),
}));
jest.mock('@/api/friends', () => ({
  ...jest.requireActual('@/api/friends'),
  getFriendshipStatus: jest.fn(),
  getFriendsSummary: jest.fn(),
  sendFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  removeFriend: jest.fn(),
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));

// Верх профиля — страница информации: цвет плашки из фото (Skia) и просмотр фото.
jest.mock('@shopify/react-native-skia', () => ({
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

jest.mock('@/features/media', () => ({ MediaViewer: () => null }));

const getProfileMock = getProfile as jest.Mock;
const useRouteParamsMock = useRouteParams as jest.Mock;
const useSessionMock = useSession as jest.Mock;
const friends = {
  status: getFriendshipStatus as jest.Mock,
  summary: getFriendsSummary as jest.Mock,
  send: sendFriendRequest as jest.Mock,
  cancel: cancelFriendRequest as jest.Mock,
  accept: acceptFriendRequest as jest.Mock,
  remove: removeFriend as jest.Mock,
};

const profile = {
  id: 'user-2',
  username: 'anna',
  displayName: 'Анна',
  avatarUrl: null,
  bio: 'Пишу о еде',
  status: 'в отпуске до понедельника',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  useRouteParamsMock.mockReturnValue({ userId: 'user-2' });
  useSessionMock.mockReturnValue({ session: { user: { id: 'user-1' } } });
  friends.status.mockResolvedValue('none');
  friends.summary.mockResolvedValue({ listVisible: true, friendsCount: 3, incomingCount: null });
  resetConfirmDialogQueue();
  (isBlockedByMe as jest.Mock).mockResolvedValue(false);
  (blockUser as jest.Mock).mockResolvedValue(undefined);
  (reportUser as jest.Mock).mockResolvedValue(undefined);
});

describe('переходы из профиля', () => {
  beforeEach(() => {
    getProfileMock.mockResolvedValue(profile);
  });

  it('открывает друзей и диалоги владельца в исходном стеке', async () => {
    await renderWithQuery(<UserProfile />);

    await fireEvent.press(await screen.findByText('Диалоги'));
    expect(mockPush).toHaveBeenLastCalledWith({ name: 'Dialogs', params: { userId: 'user-2' } });

    await fireEvent.press(await screen.findByTestId('profile-friends'));
    expect(mockPush).toHaveBeenLastCalledWith({
      name: 'Friends',
      params: { userId: 'user-2' },
    });
  });

  it('открывает новый чат с владельцем профиля', async () => {
    await renderWithQuery(<UserProfile />);
    await fireEvent.press(await screen.findByText('Написать'));

    expect(mockPush).toHaveBeenCalledWith({ name: 'NewChat', params: { with: 'user-2' } });
  });

  it('из своего профиля по динамической ссылке открывает свой список с заявками', async () => {
    useSessionMock.mockReturnValue({ session: { user: { id: 'user-2' } } });
    await renderWithQuery(<UserProfile />);
    await fireEvent.press(await screen.findByTestId('profile-friends'));

    expect(mockNavigate).toHaveBeenCalledWith({ name: 'MyFriends' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('возвращается к предыдущему экрану', async () => {
    await renderWithQuery(<UserProfile />);
    await fireEvent.press(await screen.findByTestId('info-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('при пустой истории возвращается в Чаты', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderWithQuery(<UserProfile />);
    await fireEvent.press(await screen.findByTestId('info-back'));

    expect(mockReplace).toHaveBeenCalledWith({ name: 'Tabs', params: { screen: 'chats' } });
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('UserProfile', () => {
  it('loads the profile named in the route with its status and bio', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, getByText } = await renderWithQuery(<UserProfile />);

    expect(await findByText('Анна')).toBeTruthy();
    expect(getByText('@anna')).toBeTruthy();
    expect(getByText('в отпуске до понедельника')).toBeTruthy();
    expect(getByText('Пишу о еде')).toBeTruthy();
    expect(getProfileMock).toHaveBeenCalledWith('user-2', requestClient());
  });

  it('renders someone without a username without crashing', async () => {
    getProfileMock.mockResolvedValue({ ...profile, username: null, displayName: null });

    const { findByText } = await renderWithQuery(<UserProfile />);

    expect(await findByText('Без имени')).toBeTruthy();
  });

  it('offers no follow button — there are no subscriptions', async () => {
    getProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<UserProfile />);
    await findByText('Анна');

    expect(queryByText('Подписаться')).toBeNull();
  });

  it('does not offer to write to yourself', async () => {
    useSessionMock.mockReturnValue({ session: { user: { id: 'user-2' } } });
    getProfileMock.mockResolvedValue(profile);

    const { findByText, queryByText } = await renderWithQuery(<UserProfile />);
    await findByText('Анна');

    expect(queryByText('Написать')).toBeNull();
  });

  it('offers a retry when the profile fails to load', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(profile);

    const { findByText } = await renderWithQuery(<UserProfile />);
    await fireEvent.press(await findByText('Повторить'));

    expect(await findByText('Анна')).toBeTruthy();
  });
});

describe('UserProfile — друзья', () => {
  /** Действие меняет пару на сервере — и статус, перечитанный после него, тоже. */
  function serverAnswers(action: jest.Mock, status: string) {
    action.mockImplementation(() => {
      friends.status.mockResolvedValue(status);

      return Promise.resolve(status);
    });
  }

  function renderProfile() {
    getProfileMock.mockResolvedValue(profile);

    return renderWithQuery(
      <>
        <UserProfile />
        <ConfirmDialogHost />
      </>,
    );
  }

  it('К4.1 «Добавить в друзья» отправляет заявку, кнопка — «Заявка отправлена»', async () => {
    serverAnswers(friends.send, 'outgoing');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Добавить в друзья'));

    expect(friends.send).toHaveBeenCalledWith('user-2', requestClient());
    expect(await screen.findByText('Заявка отправлена')).toBeTruthy();
  });

  it('К4.3 отклонённая заявка выглядит так же — «Заявка отправлена», её можно отменить', async () => {
    friends.status.mockResolvedValue('outgoing');
    serverAnswers(friends.cancel, 'none');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Заявка отправлена'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить заявку' }));

    await waitFor(() => expect(friends.cancel).toHaveBeenCalledWith('user-2', requestClient()));
    expect(await screen.findByText('Добавить в друзья')).toBeTruthy();
  });

  it('К4.2 встречная заявка — «Принять заявку», после неё «Вы друзья»', async () => {
    friends.status.mockResolvedValue('incoming');
    serverAnswers(friends.accept, 'friends');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Принять заявку'));

    expect(friends.accept).toHaveBeenCalledWith('user-2', requestClient());
    expect(await screen.findByText('Вы друзья')).toBeTruthy();
  });

  it('К4.5 «Вы друзья» → «Удалить из друзей» → снова «Добавить в друзья»', async () => {
    friends.status.mockResolvedValue('friends');
    serverAnswers(friends.remove, 'none');
    await renderProfile();

    await fireEvent.press(await screen.findByText('Вы друзья'));
    await fireEvent.press(await screen.findByText('Удалить из друзей'));

    expect(friends.remove).toHaveBeenCalledWith('user-2', requestClient());
    expect(await screen.findByText('Добавить в друзья')).toBeTruthy();
  });

  it('лимит заявок — понятный текст, а не сырой ответ', async () => {
    friends.send.mockRejectedValue(new FriendRequestLimitError());
    await renderProfile();

    await fireEvent.press(await screen.findByText('Добавить в друзья'));

    expect(
      await screen.findByText('Слишком много заявок в друзья. Попробуйте позже.'),
    ).toBeTruthy();
  });

  it('К5.3 список скрыт его настройкой — строки «Друзья» нет', async () => {
    friends.summary.mockResolvedValue({
      listVisible: false,
      friendsCount: null,
      incomingCount: null,
    });
    await renderProfile();
    await screen.findByText('Добавить в друзья');

    expect(screen.queryByTestId('profile-friends')).toBeNull();
  });

  it('статус не загрузился — нажатие перечитывает его, а не молчит', async () => {
    friends.status.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('incoming');
    await renderProfile();

    expect(
      await screen.findByText('Не удалось загрузить. Нажмите, чтобы попробовать ещё раз.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('friend-button'));

    expect(await screen.findByText('Принять заявку')).toBeTruthy();
    expect(friends.send).not.toHaveBeenCalled();
  });

  it('у себя кнопки дружбы нет', async () => {
    useSessionMock.mockReturnValue({ session: { user: { id: 'user-2' } } });
    friends.status.mockResolvedValue('self');
    await renderProfile();
    await screen.findByText('Анна');

    expect(screen.queryByTestId('friend-button')).toBeNull();
  });
});

describe('UserProfile — блокировка и жалоба', () => {
  function renderProfile() {
    getProfileMock.mockResolvedValue(profile);

    return renderWithQuery(
      <>
        <UserProfile />
        <ConfirmDialogHost />
      </>,
    );
  }

  it('К2 «Ещё» → «Заблокировать» — только после подтверждения с пояснением', async () => {
    await renderProfile();

    await fireEvent.press(await screen.findByTestId('person-safety-button'));
    await fireEvent.press(await screen.findByText('Заблокировать'));
    expect(await screen.findByText('Заблокировать Анна?')).toBeTruthy();
    expect(screen.getByText(/О блокировке ему не сообщат/)).toBeTruthy();
    expect(blockUser).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole('button', { name: 'Заблокировать' });
    await fireEvent.press(buttons[buttons.length - 1]);

    await waitFor(() => expect(blockUser).toHaveBeenCalledWith('user-2', requestClient()));
  });

  it('заблокированному мной — «Разблокировать» в меню', async () => {
    (isBlockedByMe as jest.Mock).mockResolvedValue(true);
    await renderProfile();

    await fireEvent.press(await screen.findByText('Заблокирован(а) · Ещё'));

    expect(await screen.findByText('Разблокировать')).toBeTruthy();
    expect(screen.queryByText('Заблокировать')).toBeNull();
  });

  it('К3.1 жалоба на профиль без блокировки', async () => {
    await renderProfile();

    await fireEvent.press(await screen.findByTestId('person-safety-button'));
    await fireEvent.press(await screen.findByText('Пожаловаться'));
    await fireEvent.press(await screen.findByText('Угрозы'));
    await fireEvent(screen.getByTestId('report-also-block'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('report-send'));

    expect(await screen.findByText('Жалоба отправлена')).toBeTruthy();
    expect(reportUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-2', reason: 'threats', chatId: null, block: false }), requestClient()
    );
  });

  it('К2.1 профиль заблокировавшего — «Пользователь недоступен», без повтора', async () => {
    getProfileMock.mockRejectedValue(new ProfileUnavailableError());

    await renderWithQuery(<UserProfile />);

    expect(await screen.findByText('Пользователь недоступен')).toBeTruthy();
    expect(screen.queryByText('Повторить')).toBeNull();
  });
});
