import { render, screen, userEvent } from '@testing-library/react-native';

import { MessageComposer } from '.';

import { useMediaSelection } from '@/features/media/selectionStore';

const photo = {
  id: 'content://media/external/images/media/1',
  kind: 'photo' as const,
  width: 100,
  height: 100,
  durationMs: null,
};

beforeEach(() => {
  useMediaSelection.getState().clear();
});

describe('MessageComposer', () => {
  it('hides everything but the explanation when the reader is not a member', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
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
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.queryByText('M')).toBeNull();
  });

  it('calls onSend when there is media but no text', async () => {
    const onSend = jest.fn();
    useMediaSelection.getState().toggle(photo);

    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
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
        onSend={onSend}
        onTyping={jest.fn()}
        canSend
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByText('Отправить'));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows how many files are attached as a badge on the send button, not as thumbnails', async () => {
    useMediaSelection.getState().toggle(photo);
    useMediaSelection.getState().toggle({ ...photo, id: 'a2' });

    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByTestId('attached-media-strip')).toBeNull();
  });

  it('shows no badge when nothing is attached', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.queryByText('0')).toBeNull();
  });
});
