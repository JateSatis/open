import { fireEvent, render, screen } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';

import { ProfilePage } from './index';

import type { Profile } from '@/api/profile';
import type { SlideBack } from '@/components/InfoPage';
import { Text } from '@/components/Text';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

jest.mock('@shopify/react-native-skia', () => ({
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

jest.mock('@/features/media', () => ({ MediaViewer: () => null }));

const profile: Profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
  status: 'в отпуске',
};

describe('ProfilePage', () => {
  it('puts the name and the status on the photo, the bio and @username in a card under it', async () => {
    await render(<ProfilePage profile={profile} />);

    expect(screen.getByTestId('info-title')).toHaveTextContent('Максим');
    expect(screen.getByTestId('info-status')).toHaveTextContent('в отпуске');
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('ПриветО себе');
    expect(screen.getByTestId('profile-username')).toHaveTextContent('@maximИмя пользователя');
  });

  it('falls back to the username when no display name came from the provider', async () => {
    await render(<ProfilePage profile={{ ...profile, displayName: null }} />);

    expect(screen.getByTestId('info-title')).toHaveTextContent('maxim');
  });

  it('has no card, status or back button when there is nothing to show', async () => {
    await render(
      <ProfilePage
        profile={{ ...profile, username: null, displayName: null, bio: null, status: null }}
      />,
    );

    expect(screen.getByTestId('info-title')).toHaveTextContent('Без имени');
    expect(screen.queryByTestId('profile-card')).toBeNull();
    expect(screen.queryByTestId('info-status')).toBeNull();
    expect(screen.queryByTestId('info-back')).toBeNull();
  });

  it('shows the lead above the card and the actions under it', async () => {
    await render(
      <ProfilePage
        profile={profile}
        lead={<Text>Имя пользователя не задано</Text>}
        actions={<Text>Написать</Text>}
      />,
    );

    expect(screen.getByText('Имя пользователя не задано')).toBeTruthy();
    expect(screen.getByText('Написать')).toBeTruthy();
  });

  it('goes back from the arrow on the photo', async () => {
    const close = jest.fn();
    const slideBack: SlideBack = {
      offset: makeMutable(0),
      close,
      makeSwipe: () => Gesture.Pan(),
      interceptBack: () => () => undefined,
      guardLeave: () => () => undefined,
      onSwipeStart: () => () => undefined,
    };

    await render(<ProfilePage profile={profile} slideBack={slideBack} />);
    await fireEvent.press(screen.getByTestId('info-back'));

    expect(close).toHaveBeenCalled();
  });
});
