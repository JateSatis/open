import { render } from '@testing-library/react-native';

import { ProfileView } from './index';

import type { Profile } from '@/api/profile';
import { Text } from '@/components/Text';

const profile: Profile = {
  id: 'user-1',
  username: 'maxim',
  displayName: 'Максим',
  avatarUrl: null,
  bio: 'Привет',
};

describe('ProfileView', () => {
  it('shows the name, the @username and the bio', async () => {
    const { getByText } = await render(<ProfileView profile={profile} />);

    expect(getByText('Максим')).toBeTruthy();
    expect(getByText('@maxim')).toBeTruthy();
    expect(getByText('Привет')).toBeTruthy();
  });

  it('falls back to the username when no display name came from the provider', async () => {
    const { getByText } = await render(<ProfileView profile={{ ...profile, displayName: null }} />);

    expect(getByText('maxim')).toBeTruthy();
  });

  it('renders a profile with neither username nor bio without crashing', async () => {
    const { getByText, queryByText } = await render(
      <ProfileView profile={{ ...profile, username: null, displayName: null, bio: null }} />,
    );

    expect(getByText('Без имени')).toBeTruthy();
    expect(queryByText('@maxim')).toBeNull();
    expect(queryByText('Привет')).toBeNull();
  });

  it('renders the actions it is given', async () => {
    const { getByText } = await render(
      <ProfileView profile={profile} actions={<Text>Действие</Text>} />,
    );

    expect(getByText('Действие')).toBeTruthy();
  });
});
