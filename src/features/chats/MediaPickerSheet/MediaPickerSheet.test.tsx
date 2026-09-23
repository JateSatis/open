import { act, render, screen, userEvent } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { PanGesture } from 'react-native-gesture-handler';

import { MediaPickerSheet, SHEET_PAN_TEST_ID } from '.';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { resetConfirmDialogQueue } from '@/components/ConfirmDialog/store';
import type { ComposerDraft } from '@/features/chats/useComposerDraft';
import type { LibraryAsset } from '@/features/media';

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

/** Жест доводит дело до состояния React (подтверждение сброса), поэтому идёт внутри act. */
async function fireSwipe(events: Parameters<typeof fireGestureHandler<PanGesture>>[1]) {
  await act(async () => {
    fireGestureHandler<PanGesture>(getByGestureTestId(SHEET_PAN_TEST_ID), events);
  });
}

/**
 * Свайп вниз от текущего положения шита. Скорость выше порога — то же самое,
 * что короткий рывок пальцем: результат не зависит от высоты экрана, на
 * котором гоняются тесты.
 */
function swipeDown({ velocityY = 2000, translationY = 120 } = {}) {
  return fireSwipe([
    { state: State.BEGAN, translationY: 0 },
    { state: State.ACTIVE, translationY: 0 },
    { translationY: translationY / 2 },
    { translationY },
    { state: State.END, translationY, velocityY },
  ]);
}

/** Свайп вверх — тот же жест в обратную сторону, он доводит шит до верха экрана. */
function swipeUp(translationY = -2000) {
  return fireSwipe([
    { state: State.BEGAN, translationY: 0 },
    { state: State.ACTIVE, translationY: 0 },
    { translationY: translationY / 2 },
    { translationY },
    { state: State.END, translationY, velocityY: -2000 },
  ]);
}

function renderSheet(props: Partial<React.ComponentProps<typeof MediaPickerSheet>> = {}) {
  return render(
    <>
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draftWith([])}
        onTyping={jest.fn()}
        onSend={jest.fn()}
        {...props}
      />
      <ConfirmDialogHost />
    </>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetConfirmDialogQueue();
});

describe('MediaPickerSheet', () => {
  it(
    'closes on a swipe down when nothing is selected',
    async () => {
      const onDismiss = jest.fn();

      await renderSheet({ onDismiss });
      await swipeDown();

      expect(screen.queryByText(/Отменить выбор файлов/)).toBeNull();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    },
    // Первый тест в файле тянет холодную инициализацию моков
    // reanimated/gesture-handler — на этом фоне 5-секундный таймаут по
    // умолчанию иногда не хватает, хотя сам рендер занимает миллисекунды.
    15_000,
  );

  it('has no close button — the sheet is dismissed by gestures and by the backdrop', async () => {
    await renderSheet();

    expect(screen.queryByLabelText('Закрыть')).toBeNull();
  });

  it('stays open when the swipe down is too short to count as a dismissal', async () => {
    const onDismiss = jest.fn();

    await renderSheet({ onDismiss });
    await swipeDown({ velocityY: 0, translationY: 8 });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('collapses back to half height instead of closing when the same swipe started at the top', async () => {
    const onDismiss = jest.fn();

    await renderSheet({ onDismiss, draft: draftWith([]) });
    // Тот же палец: сперва развернули шит на весь экран…
    await swipeUp();
    // …и следующим движением тянем вниз через весь экран — шит
    // останавливается на половине и дальше в этом жесте не идёт.
    await swipeDown({ translationY: 5000 });

    expect(onDismiss).not.toHaveBeenCalled();

    // А вот уже отдельный свайп вниз с половины — закрывает.
    await swipeDown();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation when swiped down with files selected, and keeps them on cancel', async () => {
    const onDismiss = jest.fn();
    const draft = draftWith([photo]);

    await renderSheet({ onDismiss, draft });
    await swipeDown();

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByText('Отмена'));

    expect(draft.clearMedia).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('clears the media and closes once discard is confirmed', async () => {
    const onDismiss = jest.fn();
    const draft = draftWith([photo]);

    await renderSheet({ onDismiss, draft });
    await swipeDown();
    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Сбросить'));

    expect(draft.clearMedia).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('asks the same question on a backdrop tap while files are selected', async () => {
    const onDismiss = jest.fn();

    await renderSheet({ onDismiss, draft: draftWith([photo]) });

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes right away on a backdrop tap when nothing is selected', async () => {
    const onDismiss = jest.fn();

    await renderSheet({ onDismiss });

    const user = userEvent.setup();
    await user.press(screen.getByTestId('media-picker-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the composer footer only once a file is selected', async () => {
    const { rerender } = await renderSheet();

    expect(screen.queryByLabelText('Сообщение')).toBeNull();

    await rerender(
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

    expect(await screen.findByLabelText('Сообщение')).toBeTruthy();
  });

  it('sends and closes when the footer composer submits', async () => {
    const onDismiss = jest.fn();
    const onSend = jest.fn();

    await renderSheet({ onDismiss, onSend, draft: draftWith([photo]) });

    const user = userEvent.setup();
    await user.press(await screen.findByText('Отправить'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing until it is made visible', async () => {
    const { rerender } = await render(
      <MediaPickerSheet
        visible={false}
        onDismiss={jest.fn()}
        draft={draftWith([])}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('media-picker-backdrop')).toBeNull();

    await rerender(
      <MediaPickerSheet
        visible
        onDismiss={jest.fn()}
        draft={draftWith([])}
        onTyping={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    expect(await screen.findByTestId('media-picker-backdrop')).toBeTruthy();
  });
});
