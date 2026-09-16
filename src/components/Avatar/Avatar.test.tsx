import { render } from '@testing-library/react-native';

import { Avatar } from '.';

describe('Avatar', () => {
  it('renders an initial when there is no image', async () => {
    const { getByText } = await render(<Avatar name="Maksim" />);

    expect(getByText('M')).toBeTruthy();
  });
});
