import { render } from '@testing-library/react-native';

import SignInScreen from './sign-in';

describe('SignInScreen', () => {
  it('renders the placeholder copy', async () => {
    const { getByText } = await render(<SignInScreen />);

    expect(getByText('Вход')).toBeTruthy();
  });
});
