import { fireEvent, screen } from '@testing-library/react-native';

import { PrivacyScreen } from '.';

import {
  AliasLimitError,
  getMyPrivacySettings,
  regenerateIdentityAlias,
  setPrivacySetting,
  type PrivacySettings,
} from '@/api/privacy';
import { renderWithQuery } from '@/features/profile/renderWithQuery';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => 'me' }));
jest.mock('@/api/privacy', () => {
  const actual = jest.requireActual('@/api/privacy');

  return {
    ...actual,
    getMyPrivacySettings: jest.fn(),
    setPrivacySetting: jest.fn(),
    regenerateIdentityAlias: jest.fn(),
  };
});

const mockedSettings = jest.mocked(getMyPrivacySettings);
const mockedSet = jest.mocked(setPrivacySetting);
const mockedRegenerate = jest.mocked(regenerateIdentityAlias);

function settings(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    birthDate: '2011-03-01',
    friendsListVisibility: 'nobody',
    activityStatusVisibility: 'friends',
    messageTimeVisibility: 'friends',
    searchVisibility: 'friends',
    identityVisibility: 'friends',
    dialogueNameVisibility: 'friends',
    avatarVisibility: 'friends',
    identityAlias: 'Илья Муромцев',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSet.mockResolvedValue(undefined);
});

it('К4.1 у подростка три настройки идентичности — «Только друзья»', async () => {
  mockedSettings.mockResolvedValue(settings());
  await renderWithQuery(<PrivacyScreen />);

  expect(await screen.findByText('Идентичность')).toBeTruthy();
  for (const title of [
    'Кто видит моё имя и username',
    'Кто видит моё имя в моих диалогах',
    'Кто видит мою фотографию',
  ]) {
    expect(screen.getByLabelText(`${title}: Только друзья, выбрано`)).toBeTruthy();
  }
});

it('К4.1 у взрослого — «Все»', async () => {
  mockedSettings.mockResolvedValue(
    settings({ identityVisibility: 'everyone', dialogueNameVisibility: 'everyone', avatarVisibility: 'everyone' }),
  );
  await renderWithQuery(<PrivacyScreen />);

  expect(await screen.findByLabelText('Кто видит моё имя и username: Все, выбрано')).toBeTruthy();
  expect(screen.getByLabelText('Кто видит моё имя в моих диалогах: Все, выбрано')).toBeTruthy();
  expect(screen.getByLabelText('Кто видит мою фотографию: Все, выбрано')).toBeTruthy();
});

it('не обещает анонимности: скрывается имя, а не то, что вы пишете', async () => {
  mockedSettings.mockResolvedValue(settings());
  await renderWithQuery(<PrivacyScreen />);

  expect(await screen.findByText(/скрывает имя, но не то, что вы пишете/)).toBeTruthy();
});

it('смена настройки имени уходит на сервер своим ключом', async () => {
  mockedSettings.mockResolvedValue(settings());
  await renderWithQuery(<PrivacyScreen />);

  await fireEvent.press(await screen.findByLabelText('Кто видит моё имя и username: Никто'));

  expect(mockedSet).toHaveBeenCalledWith('profile_identity_masking', 'nobody');
});

it('К4.2 «Другой псевдоним» сразу обновляет строку', async () => {
  mockedSettings.mockResolvedValue(settings());
  mockedRegenerate.mockResolvedValue('Вера Соколова');
  await renderWithQuery(<PrivacyScreen />);

  expect(await screen.findByText('Для тех, от кого скрыто имя, вы — Илья Муромцев')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('privacy-alias-regenerate'));

  expect(await screen.findByText('Для тех, от кого скрыто имя, вы — Вера Соколова')).toBeTruthy();
});

it('К4.2 при лимите — понятный текст, псевдоним прежний', async () => {
  mockedSettings.mockResolvedValue(settings());
  mockedRegenerate.mockRejectedValue(new AliasLimitError());
  await renderWithQuery(<PrivacyScreen />);

  await fireEvent.press(await screen.findByTestId('privacy-alias-regenerate'));

  expect(await screen.findByText(/не больше 5 раз в сутки/)).toBeTruthy();
  expect(screen.getByText('Для тех, от кого скрыто имя, вы — Илья Муромцев')).toBeTruthy();
});
