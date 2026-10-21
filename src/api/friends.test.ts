import {
  FRIENDS_PAGE_SIZE,
  FriendRequestLimitError,
  FriendsListHiddenError,
  getFriendsSummary,
  getFriendshipStatus,
  listFriends,
  removeFriend,
  sendFriendRequest,
} from './friends';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('friends api', () => {
  it('заявка — функцией базы, не записью в таблицу', async () => {
    mockedRpc.mockResolvedValue({ data: 'outgoing', error: null });

    await expect(sendFriendRequest('user-2')).resolves.toBe('outgoing');
    expect(mockedRpc).toHaveBeenCalledWith('send_friend_request', { p_user: 'user-2' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('лимит частоты (OPN05) — своей ошибкой с человеческим текстом', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'OPN05', message: 'raw' } });

    await expect(sendFriendRequest('user-2')).rejects.toBeInstanceOf(FriendRequestLimitError);
  });

  it('неизвестный ответ статуса читается как «нет связи»', async () => {
    mockedRpc.mockResolvedValue({ data: 'declined', error: null });

    await expect(getFriendshipStatus('user-2')).resolves.toBe('none');
  });

  it('удаление из друзей — для обоих, функцией', async () => {
    mockedRpc.mockResolvedValue({ data: 'none', error: null });

    await expect(removeFriend('user-2')).resolves.toBe('none');
    expect(mockedRpc).toHaveBeenCalledWith('remove_friend', { p_user: 'user-2' });
  });

  it('список скрыт настройкой (42501) — отдельная ошибка, а не пустой список', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'raw' } });

    await expect(listFriends('user-2', null)).rejects.toBeInstanceOf(FriendsListHiddenError);
  });

  it('страница друзей и курсор следующей', async () => {
    const rows = Array.from({ length: FRIENDS_PAGE_SIZE }, (_, index) => ({
      friendship_id: `f-${index}`,
      accepted_at: `2026-10-${String(20 - (index % 20)).padStart(2, '0')}T00:00:00Z`,
      user_id: `u-${index}`,
      display_name: `Имя ${index}`,
      username: null,
      avatar_url: null,
    }));
    mockedRpc.mockResolvedValue({ data: rows, error: null });

    const page = await listFriends('user-2', { at: '2026-10-21T00:00:00Z', id: 'f-x' });

    expect(mockedRpc).toHaveBeenCalledWith('list_friends', {
      p_user: 'user-2',
      p_limit: FRIENDS_PAGE_SIZE,
      p_before_accepted_at: '2026-10-21T00:00:00Z',
      p_before_id: 'f-x',
    });
    expect(page.items).toHaveLength(FRIENDS_PAGE_SIZE);
    expect(page.next).toEqual({ at: rows.at(-1)?.accepted_at, id: rows.at(-1)?.friendship_id });
  });

  it('сводка: чужие входящие и скрытый счётчик приходят пустыми', async () => {
    mockedRpc.mockResolvedValue({
      data: { list_visible: false, friends_count: null, incoming_count: null },
      error: null,
    });

    await expect(getFriendsSummary('user-2')).resolves.toEqual({
      listVisible: false,
      friendsCount: null,
      incomingCount: null,
    });
  });
});
