import { render } from '@testing-library/react-native';

import ChatsScreen from './index';

describe('ChatsScreen', () => {
  it('renders the placeholder copy', async () => {
    const { getByText } = await render(<ChatsScreen />);

    expect(getByText('Чаты')).toBeTruthy();
  });
});
