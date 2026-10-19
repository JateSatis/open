import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import { createRef } from 'react';
import { View, type TextInput } from 'react-native';

import { MessageComposer } from '.';

import { closeEmojiPanel } from '@/features/chats/EmojiPanel';

import { useMediaSelection } from '@/features/media/selectionStore';

// Жест и рекордер проверены в самой фиче `media`; здесь важно лишь, где
// строка записи есть и что готовое голосовое уходит наверх.
jest.mock('@/features/media/HoldToRecordRow', () => {
  const { Pressable, Text, View } = require('react-native');

  return {
    // Как настоящая строка: на месте микрофона — `trailing`, если он есть.
    HoldToRecordRow: ({
      children,
      onSend,
      trailing,
    }: {
      children: unknown;
      onSend: (v: unknown) => void;
      trailing?: unknown;
    }) => (
      <View>
        {children}
        {trailing ?? (
          <Pressable
            accessibilityLabel="Микрофон"
            onPress={() => onSend({ kind: 'voice', uri: 'file:///v.m4a' })}
          >
            <Text>mic</Text>
          </Pressable>
        )}
      </View>
    ),
  };
});

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

    expect(screen.getByLabelText('Фото и видео')).toBeTruthy();
  });

  it('only prepares the sheet on touch and opens it when the finger is lifted', async () => {
    const calls: string[] = [];

    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
        onAttachPressIn={() => calls.push('in')}
        onAttachPressOut={() => calls.push('out')}
        onAttachPress={() => calls.push('press')}
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Фото и видео'));

    expect(calls).toEqual(['in', 'out', 'press']);
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

    expect(screen.queryByLabelText('Фото и видео')).toBeNull();
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
    await user.press(screen.getByLabelText('Отправить'));

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
    await user.press(screen.getByLabelText('Отправить'));

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

  it('offers voice recording to a member and hands the recording up', async () => {
    const onSendVoice = jest.fn();

    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
        onSendVoice={onSendVoice}
      />,
    );

    await userEvent.setup().press(screen.getByLabelText('Микрофон'));

    expect(onSendVoice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'voice' }));
  });

  it('has no voice button inside the media sheet copy', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend
      />,
    );

    expect(screen.queryByLabelText('Микрофон')).toBeNull();
  });

  it('has no voice button for a reader who is not a member', async () => {
    await render(
      <MessageComposer
        text=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        onTyping={jest.fn()}
        canSend={false}
        onSendVoice={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Микрофон')).toBeNull();
  });

  describe('while editing', () => {
    const edit = { canSave: true, textLocked: false, attachDisabled: false, recordDisabled: true };

    it('saves rather than sends, and lets the edit decide whether there is something to save', async () => {
      const onSend = jest.fn();

      await render(
        <MessageComposer
          text=""
          onChangeText={jest.fn()}
          onSend={onSend}
          onTyping={jest.fn()}
          canSend
          edit={edit}
        />,
      );

      // Поле пустое, но у сообщения остались фото — сохранить есть что.
      await userEvent.setup().press(screen.getByLabelText('Сохранить'));
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText('Отправить')).toBeNull();
    });

    it('keeps «Сохранить» off when the result would be empty and nothing can be recorded', async () => {
      await render(
        <MessageComposer
          text="  "
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onTyping={jest.fn()}
          canSend
          edit={{ ...edit, canSave: false }}
        />,
      );

      expect(screen.getByLabelText('Сохранить')).toBeDisabled();
    });

    it('locks the caption and the media button while a voice message stays', async () => {
      await render(
        <MessageComposer
          text=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onTyping={jest.fn()}
          canSend
          onAttachPress={jest.fn()}
          edit={{ ...edit, textLocked: true, attachDisabled: true }}
        />,
      );

      expect(screen.getByLabelText('Сообщение').props.editable).toBe(false);
      expect(screen.getByLabelText('Фото и видео')).toBeDisabled();
    });
  });

  describe('the button on the right', () => {
    const base = {
      onChangeText: jest.fn(),
      onSend: jest.fn(),
      onTyping: jest.fn(),
      canSend: true,
      onSendVoice: jest.fn(),
    };

    it('is the microphone while there is nothing to send, and «Отправить» once there is', async () => {
      const { rerender } = await render(<MessageComposer {...base} text="" />);

      expect(screen.getByLabelText('Микрофон')).toBeTruthy();
      expect(screen.queryByLabelText('Отправить')).toBeNull();

      await rerender(<MessageComposer {...base} text="привет" />);

      expect(screen.queryByLabelText('Микрофон')).toBeNull();
      expect(screen.getByLabelText('Отправить')).toBeEnabled();

      await rerender(<MessageComposer {...base} text="" />);

      expect(screen.getByLabelText('Микрофон')).toBeTruthy();
    });

    it('turns into «Отправить» with the counter when media is picked', async () => {
      useMediaSelection.getState().toggle(photo);
      useMediaSelection.getState().toggle({ ...photo, id: 'a2' });

      await render(<MessageComposer {...base} text="" />);

      expect(screen.queryByLabelText('Микрофон')).toBeNull();
      expect(screen.getByLabelText('Отправить')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('in an edit is «Сохранить», and the microphone only while there is nothing to save but a recording is allowed', async () => {
      const edit = {
        canSave: true,
        textLocked: false,
        attachDisabled: false,
        recordDisabled: true,
      };
      const { rerender } = await render(<MessageComposer {...base} text="а" edit={edit} />);

      expect(screen.getByLabelText('Сохранить')).toBeTruthy();
      expect(screen.queryByLabelText('Микрофон')).toBeNull();

      await rerender(
        <MessageComposer
          {...base}
          text=""
          edit={{ ...edit, canSave: false, recordDisabled: false }}
        />,
      );

      expect(screen.queryByLabelText('Сохранить')).toBeNull();
      expect(screen.getByLabelText('Микрофон')).toBeTruthy();
    });

    it('is always «Отправить» in the media sheet copy, which has no microphone', async () => {
      await render(<MessageComposer {...base} onSendVoice={undefined} text="" />);

      expect(screen.queryByLabelText('Микрофон')).toBeNull();
      expect(screen.getByLabelText('Отправить')).toBeDisabled();
    });
  });

  describe('emoji', () => {
    it('opens the panel from the button in the field and swaps the button for the keyboard', async () => {
      await render(
        <MessageComposer
          text=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onTyping={jest.fn()}
          canSend
        />,
      );

      expect(screen.queryByTestId('emoji-panel')).toBeNull();

      await userEvent.setup().press(screen.getByLabelText('Эмодзи'));

      expect(screen.getByTestId('emoji-panel')).toBeTruthy();
      expect(screen.getByLabelText('Клавиатура')).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Недавние' })).toBeTruthy();
    });

    it('puts the emoji where the cursor is and erases a whole emoji before it', async () => {
      const onChangeText = jest.fn();
      const inputRef = createRef<TextInput>();
      const props = {
        onChangeText,
        onSend: jest.fn(),
        onTyping: jest.fn(),
        canSend: true,
        inputRef,
      };
      const { rerender } = await render(<MessageComposer {...props} text="привет мир" />);
      const setSelection = jest.fn();

      // Поле в тестах без нативной части: курсор ставит `setSelection`.
      Object.assign(inputRef.current as object, { setSelection });

      fireEvent(screen.getByLabelText('Сообщение'), 'selectionChange', {
        nativeEvent: { selection: { start: 6, end: 6 } },
      });
      await userEvent.setup().press(screen.getByLabelText('Эмодзи'));
      await userEvent.setup().press(screen.getByTestId('emoji-😀'));

      expect(onChangeText).toHaveBeenLastCalledWith('привет😀 мир');

      // Текст пришёл сверху — курсор сразу за эмодзи, а не в конце.
      await rerender(<MessageComposer {...props} text="привет😀 мир" />);
      expect(setSelection).toHaveBeenLastCalledWith(8, 8);

      await rerender(<MessageComposer {...props} text="привет👍🏽 мир" />);
      fireEvent(screen.getByLabelText('Сообщение'), 'selectionChange', {
        nativeEvent: { selection: { start: 10, end: 10 } },
      });
      await userEvent.setup().press(screen.getByLabelText('Стереть'));

      expect(onChangeText).toHaveBeenLastCalledWith('привет мир');
    });
  });

  describe('one emoji panel for several fields', () => {
    const field = (owner: 'chat' | 'sheet', testID: string) => (
      <View testID={testID}>
        <MessageComposer
          text=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onTyping={jest.fn()}
          canSend
          keyboardOwner={owner}
        />
      </View>
    );

    it('closes only its own panel from a window «back», and gives it up to the field that takes it', async () => {
      await render(
        <>
          {field('chat', 'chat')}
          {field('sheet', 'sheet')}
        </>,
      );
      const user = userEvent.setup();

      await user.press(within(screen.getByTestId('chat')).getByLabelText('Эмодзи'));

      // «Назад» окна шита чужую панель не трогает.
      expect(closeEmojiPanel('sheet')).toBe(false);
      expect(within(screen.getByTestId('chat')).getByLabelText('Клавиатура')).toBeTruthy();

      // Шит открыл свою — у чата панели больше нет.
      await user.press(within(screen.getByTestId('sheet')).getByLabelText('Эмодзи'));

      expect(within(screen.getByTestId('chat')).getByLabelText('Эмодзи')).toBeTruthy();
      expect(within(screen.getByTestId('sheet')).getByLabelText('Клавиатура')).toBeTruthy();
      await act(() => {
        expect(closeEmojiPanel('sheet')).toBe(true);
      });
      expect(within(screen.getByTestId('sheet')).getByLabelText('Эмодзи')).toBeTruthy();
    });
  });
});
