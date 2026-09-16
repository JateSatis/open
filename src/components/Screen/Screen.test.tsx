import { Text as RNText } from 'react-native';

import { render } from '@testing-library/react-native';

import { Screen } from '.';

describe('Screen', () => {
  it('renders its children', async () => {
    const { getByText } = await render(
      <Screen>
        <RNText>Content</RNText>
      </Screen>,
    );

    expect(getByText('Content')).toBeTruthy();
  });
});
