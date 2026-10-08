import { fireEvent, render, screen } from '@testing-library/react-native';

import { PopAttachmentChip } from '.';

describe('PopAttachmentChip', () => {
  it('lets the pop of a new post be unpinned with ✕', async () => {
    const onRemove = jest.fn();

    await render(
      <PopAttachmentChip posterUri="file:///frame.jpg" onRemove={onRemove} standalone />,
    );

    expect(screen.getByText('Pop')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Открепить поп'));

    expect(onRemove).toHaveBeenCalled();
  });

  it('has no ✕ when the pop cannot be removed', async () => {
    await render(<PopAttachmentChip posterUri={null} />);

    expect(screen.queryByLabelText('Открепить поп')).toBeNull();
  });
});
