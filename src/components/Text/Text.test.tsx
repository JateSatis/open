import { render } from '@testing-library/react-native';

import { Text } from '.';

describe('Text', () => {
  it('renders its children', async () => {
    const { getByText } = await render(<Text>Hello, Open</Text>);

    expect(getByText('Hello, Open')).toBeTruthy();
  });
});
