import { act, render, screen, userEvent } from '@testing-library/react-native';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { MediaTile } from '.';

import type { MessageAttachment } from '@/api/chats';
import { createTileRegistry, setHiddenTile } from '@/features/media/tileRegistry';

const photo: MessageAttachment = {
  id: 'att-1',
  url: 'https://cdn.example/photo.jpg',
  posterUrl: null,
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
  durationMs: null,
  waveform: null,
};

const tile = { x: 0, y: 0, width: 200, height: 150 };

type TapHandlers = {
  onBegin?: (event: object) => void;
  onFinalize?: (event: object, success: boolean) => void;
};

/**
 * Жест тапа плитки по шагам. `fireGestureHandler` достраивает касание до
 * конца, а здесь нужен палец, который лежит и ждёт, — обработчики зовутся
 * напрямую.
 */
function tapHandlers(): TapHandlers {
  return (getByGestureTestId('media-tile-tap-0') as unknown as { handlers: TapHandlers }).handlers;
}

function fingerDown() {
  tapHandlers().onBegin?.({});
}

function fingerGone() {
  tapHandlers().onFinalize?.({}, false);
}

beforeEach(() => {
  jest.useFakeTimers();
  setHiddenTile(null, null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MediaTile', () => {
  it('opens the viewer at its own index — a screen reader taps it too', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await render(<MediaTile attachment={photo} index={2} tile={tile} onPress={onPress} />);
    await user.press(screen.getByLabelText('Открыть фото'));

    expect(onPress).toHaveBeenCalledWith(2, null);
  });

  it('gets the viewer ready while the finger rests and drops it when no tap follows', async () => {
    const onArm = jest.fn();
    const onDisarm = jest.fn();

    await render(
      <MediaTile
        attachment={photo}
        index={0}
        tile={tile}
        onPress={jest.fn()}
        onArm={onArm}
        onDisarm={onDisarm}
      />,
    );

    await act(async () => {
      fingerDown();
      jest.advanceTimersByTime(400);
    });

    expect(onArm).toHaveBeenCalledWith(0, null);

    await act(async () => {
      fingerGone();
    });

    expect(onDisarm).toHaveBeenCalled();
  });

  it('does not get the viewer ready when the finger starts a scroll at once', async () => {
    const onArm = jest.fn();
    const onDisarm = jest.fn();

    await render(
      <MediaTile
        attachment={photo}
        index={0}
        tile={tile}
        onPress={jest.fn()}
        onArm={onArm}
        onDisarm={onDisarm}
      />,
    );

    await act(async () => {
      fingerDown();
      fingerGone();
      jest.advanceTimersByTime(400);
    });

    expect(onArm).not.toHaveBeenCalled();
    expect(onDisarm).not.toHaveBeenCalled();
  });

  it('drops a ready viewer when the tile leaves the list under the finger', async () => {
    const onDisarm = jest.fn();
    const view = await render(
      <MediaTile
        attachment={photo}
        index={0}
        tile={tile}
        onPress={jest.fn()}
        onArm={jest.fn()}
        onDisarm={onDisarm}
      />,
    );

    await act(async () => {
      fingerDown();
      jest.advanceTimersByTime(400);
    });
    await view.unmount();

    expect(onDisarm).toHaveBeenCalled();
  });

  it('empties only the tile of its own bubble while the viewer is open', async () => {
    const mine = createTileRegistry();
    const other = createTileRegistry();

    await render(
      <MediaTile attachment={photo} index={0} tile={tile} onPress={jest.fn()} tiles={mine} />,
    );

    // То же вложение в другом списке (чат позади панели комментариев).
    await act(async () => setHiddenTile(other, photo.id));
    expect(screen.getByTestId('media-tile-image')).not.toHaveStyle({ opacity: 0 });

    await act(async () => setHiddenTile(mine, photo.id));
    expect(screen.getByTestId('media-tile-image')).toHaveStyle({ opacity: 0 });
  });
});
