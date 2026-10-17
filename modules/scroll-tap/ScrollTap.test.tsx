import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ScrollTap } from '.';

describe('ScrollTap', () => {
  it('without the native module stays a plain wrapper around the list', async () => {
    await render(
      <ScrollTap testID="wrapper">
        <Text>list</Text>
      </ScrollTap>,
    );

    expect(screen.getByTestId('wrapper')).toBeTruthy();
    expect(screen.getByText('list')).toBeTruthy();
  });
});
