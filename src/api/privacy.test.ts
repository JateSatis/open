import {
  AliasLimitError,
  BirthDateInFutureError,
  BirthDateTooYoungError,
  getMyPrivacySettings,
  regenerateIdentityAlias,
  setBirthDate,
  setPrivacySetting,
} from './privacy';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('privacy api', () => {
  it('дата уходит днём, а возраст решает сервер', async () => {
    mockedRpc.mockResolvedValue({ data: { initialized: true }, error: null });

    await setBirthDate('2010-05-01');

    expect(mockedRpc).toHaveBeenCalledWith('set_birth_date', { p_birth_date: '2010-05-01' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('младше 13 (OPN04) и будущее (OPN03) — разные ошибки', async () => {
    mockedRpc.mockResolvedValueOnce({ data: null, error: { code: 'OPN04', message: 'raw' } });
    await expect(setBirthDate('2020-01-01')).rejects.toBeInstanceOf(BirthDateTooYoungError);

    mockedRpc.mockResolvedValueOnce({ data: null, error: { code: 'OPN03', message: 'raw' } });
    await expect(setBirthDate('2999-01-01')).rejects.toBeInstanceOf(BirthDateInFutureError);
  });

  it('настройка — одной функцией с ключом и значением', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });

    await setPrivacySetting('friends_list_visibility', 'friends');

    expect(mockedRpc).toHaveBeenCalledWith('set_privacy_setting', {
      p_key: 'friends_list_visibility',
      p_value: 'friends',
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('мои настройки; запись из одних null — строки нет', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        id: 's-1',
        birth_date: null,
        friends_list_visibility: 'nobody',
        profile_identity_masking: 'friends',
        identity_alias: 'Илья Муромцев',
      },
      error: null,
    });
    await expect(getMyPrivacySettings()).resolves.toEqual({
      birthDate: null,
      friendsListVisibility: 'nobody',
      identityVisibility: 'friends',
      identityAlias: 'Илья Муромцев',
      // Чего сервер не прислал — защитное «никто».
      activityStatusVisibility: 'nobody',
      messageTimeVisibility: 'nobody',
      searchVisibility: 'nobody',
      dialogueNameVisibility: 'nobody',
      avatarVisibility: 'nobody',
    });

    mockedRpc.mockResolvedValueOnce({ data: { id: null }, error: null });
    await expect(getMyPrivacySettings()).resolves.toBeNull();
  });

  it('другой псевдоним — новый от сервера; лимит за сутки (OPN13) — своя ошибка', async () => {
    mockedRpc.mockResolvedValueOnce({ data: 'Вера Соколова', error: null });
    await expect(regenerateIdentityAlias()).resolves.toBe('Вера Соколова');
    expect(mockedRpc).toHaveBeenCalledWith('regenerate_identity_alias');

    mockedRpc.mockResolvedValueOnce({ data: null, error: { code: 'OPN13', message: 'raw' } });
    await expect(regenerateIdentityAlias()).rejects.toBeInstanceOf(AliasLimitError);
  });
});
