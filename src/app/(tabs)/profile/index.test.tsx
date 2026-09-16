import { render } from '@testing-library/react-native';

import ProfileScreen from './index';

describe('ProfileScreen', () => {
  it('renders the placeholder copy', async () => {
    const { getByText } = await render(<ProfileScreen />);

    expect(getByText('Профиль')).toBeTruthy();
  });
});
