import { render, screen, userEvent } from '@testing-library/react-native';

import { AttachedMediaStrip } from '.';

import type { LibraryAsset } from '@/features/media';

const photo: LibraryAsset = {
  id: 'a1',
  kind: 'photo',
  uri: 'file:///cache/a1.jpg',
  width: 100,
  height: 100,
  durationMs: null,
};

describe('AttachedMediaStrip', () => {
  it('renders nothing when nothing is attached', async () => {
    const { toJSON } = await render(<AttachedMediaStrip media={[]} onRemove={jest.fn()} />);

    expect(toJSON()).toBeNull();
  });

  it('removes a file when its thumbnail is tapped', async () => {
    const onRemove = jest.fn();

    await render(<AttachedMediaStrip media={[photo]} onRemove={onRemove} />);

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Убрать файл'));

    expect(onRemove).toHaveBeenCalledWith('a1');
  });
});
