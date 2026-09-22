import { render, screen, userEvent } from '@testing-library/react-native';

import { MessageComposer } from '.';

import type { LibraryAsset } from '@/features/media';

const photo: LibraryAsset = {
  id: 'a1',
  kind: 'photo',
  uri: 'file:///cache/a1.jpg',
  width: 100,
  height: 100,
  durationMs: null,
};

describe('MessageComposer', () => {
  it('hides everything but the explanation when the reader is not a member', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        media={[]}
        onRemoveMedia={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend={false}
      />,
    );

    expect(screen.getByText(/писать — только участники/)).toBeTruthy();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
  });

  it('shows the attach button only when opening the sheet makes sense', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        media={[]}
        onRemoveMedia={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
        onAttachPress={jest.fn()}
      />,
    );

    expect(screen.getByText('M')).toBeTruthy();
  });

  it('omits the attach button when there is nowhere to attach from (inside the sheet itself)', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        media={[]}
        onRemoveMedia={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.queryByText('M')).toBeNull();
  });

  it('calls onSend when there is media but no text', async () => {
    const onSend = jest.fn();

    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        media={[photo]}
        onRemoveMedia={jest.fn()}
        onSend={onSend}
        onTyping={jest.fn()}
        canSend
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByText('Отправить'));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not call onSend with neither text nor media', async () => {
    const onSend = jest.fn();

    await render(
      <MessageComposer
        text="   "
        onChangeText={jest.fn()}
        media={[]}
        onRemoveMedia={jest.fn()}
        onSend={onSend}
        onTyping={jest.fn()}
        canSend
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByText('Отправить'));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows the attached media strip above the field', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        media={[photo]}
        onRemoveMedia={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.getByTestId('attached-media-strip')).toBeTruthy();
  });
});
