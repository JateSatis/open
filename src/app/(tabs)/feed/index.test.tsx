import { render } from '@testing-library/react-native';

import FeedScreen from './index';

describe('FeedScreen', () => {
  it('renders the placeholder copy', async () => {
    const { getByText } = await render(<FeedScreen />);

    expect(getByText('Лента')).toBeTruthy();
  });
});
