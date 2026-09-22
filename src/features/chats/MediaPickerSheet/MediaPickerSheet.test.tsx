import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaPickerSheet } from '.';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { LibraryAsset } from '@/features/media';

// @gorhom/bottom-sheet требует reanimated/worklets, которых нет под jest —
// мок отыгрывает ровно то, чем реально пользуется MediaPickerSheet: рендер
// handle/backdrop/footer как render-prop'ов и mockPresent()/mockDismiss() через ref.
const mockDismiss = jest.fn();
const mockPresent = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  const BottomSheetModal = React.forwardRef(
    (
      {
        children,
        handleComponent: Handle,
        backdropComponent: Backdrop,
        footerComponent: Footer,
      }: {
        children: React.ReactNode;
        handleComponent?: (props: object) => React.ReactNode;
        backdropComponent?: (props: object) => React.ReactNode;
        footerComponent?: (props: object) => React.ReactNode;
      },
      ref: React.Ref<{ present: () => void; dismiss: () => void }>,
    ) => {
      React.useImperativeHandle(ref, () => ({ present: mockPresent, dismiss: mockDismiss }));

      return (
        <View>
          {Backdrop ? Backdrop({}) : null}
          {Handle ? Handle({}) : null}
          {children}
          {Footer ? Footer({ animatedFooterPosition: { value: 0 } }) : null}
        </View>
      );
    },
  );
  BottomSheetModal.displayName = 'BottomSheetModal';

  return {
    BottomSheetModal,
    BottomSheetFlatList: () => null,
    BottomSheetFooter: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    BottomSheetBackdrop: ({ onPress }: { onPress?: () => void }) => (
      <Pressable testID="backdrop" onPress={onPress} />
    ),
  };
});

jest.mock('@/features/media', () => ({
  MediaGrid: () => null,
}));

function draftWith(media: LibraryAsset[]): ComposerDraft {
  return {
    text: '',
    setText: jest.fn(),
    media,
    toggleMedia: jest.fn(),
    removeMedia: jest.fn(),
    isSelected: jest.fn(() => false),
    selectionOrder: jest.fn(() => null),
    isFull: false,
    clear: jest.fn(),
    clearMedia: jest.fn(),
  };
}

const photo: LibraryAsset = {
  id: 'a1',
  kind: 'photo',
  uri: 'file:///cache/a1.jpg',
  width: 100,
  height: 100,
  durationMs: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetConfirmDialogQueue();
});

describe('MediaPickerSheet', () => {
  it('closes right away when nothing is selected', async () => {
    const onDismiss = jest.fn();

    await render(
      <>
        <MediaPickerSheet
          visible
          onDismiss={onDismiss}
          draft={draftWith([])}
          onTyping={jest.fn()}
          onSend={jest.fn()}
        />
        <ConfirmDialogHost />
      </>,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Закрыть'));

    expect(screen.queryByText(/Отменить выбор файлов/)).toBeNull();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation before closing with files selected, and keeps them on cancel', async () => {
    const onDismiss = jest.fn();
    const draft = draftWith([photo]);

    await render(
      <>
        <MediaPickerSheet
          visible
          onDismiss={onDismiss}
          draft={draft}
          onTyping={jest.fn()}
          onSend={jest.fn()}
        />
        <ConfirmDialogHost />
      </>,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Закрыть'));

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();

    await user.press(screen.getByText('Отмена'));

    expect(draft.clearMedia).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('clears the media and closes once discard is confirmed', async () => {
    const onDismiss = jest.fn();
    const draft = draftWith([photo]);

    await render(
      <>
        <MediaPickerSheet
          visible
          onDismiss={onDismiss}
          draft={draft}
          onTyping={jest.fn()}
          onSend={jest.fn()}
        />
        <ConfirmDialogHost />
      </>,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Закрыть'));
    await screen.findByText('Отменить выбор файлов?');
    await user.press(screen.getByText('Сбросить'));

    expect(draft.clearMedia).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not close directly on a backdrop tap while files are selected', async () => {
    await render(
      <>
        <MediaPickerSheet
          visible
          onDismiss={jest.fn()}
          draft={draftWith([photo])}
          onTyping={jest.fn()}
          onSend={jest.fn()}
        />
        <ConfirmDialogHost />
      </>,
    );

    const user = userEvent.setup();
    await user.press(screen.getByTestId('backdrop'));

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('shows the composer footer only once a file is selected', async () => {
    const { rerender } = await render(
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draftWith([])}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Сообщение')).toBeNull();

    await rerender(
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draftWith([photo])}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(await screen.findByLabelText('Сообщение')).toBeTruthy();
  });

  it('sends and closes when the footer composer submits', async () => {
    const onDismiss = jest.fn();
    const onSend = jest.fn();

    await render(
      <MediaPickerSheet
        visible
        onDismiss={onDismiss}
        draft={draftWith([photo])}
        onTyping={jest.fn()}
        onSend={onSend}
      />,
    );

    const user = userEvent.setup();
    await user.press(await screen.findByText('Отправить'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
