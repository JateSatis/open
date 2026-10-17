import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaAttachmentGrid } from '.';

import type { MessageAttachment } from '@/api/chats';
import { computeMosaicLayout, mosaicBounds } from '@/features/chats/lib/mosaicLayout';

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

const video: MessageAttachment = {
  id: 'att-2',
  url: 'https://cdn.example/video.mp4',
  posterUrl: 'https://cdn.example/video.jpg',
  mimeType: 'video/mp4',
  width: 800,
  height: 600,
  durationMs: 5000,
  waveform: null,
};

const layout = computeMosaicLayout([photo, video], mosaicBounds(328), 3);

describe('MediaAttachmentGrid', () => {
  it('reports the tapped tile index so the viewer opens at the right file', async () => {
    const onPress = jest.fn();

    await render(
      <MediaAttachmentGrid attachments={[photo, video]} layout={layout} onPress={onPress} />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Открыть видео'));

    expect(onPress).toHaveBeenCalledWith(1, null);
  });

  it('marks a video tile with its duration and a play mark', async () => {
    await render(
      <MediaAttachmentGrid attachments={[photo, video]} layout={layout} onPress={jest.fn()} />,
    );

    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('takes its size from the layout, so the row does not jump before images load', async () => {
    await render(
      <MediaAttachmentGrid attachments={[photo, video]} layout={layout} onPress={jest.fn()} />,
    );

    expect(screen.getByTestId('media-mosaic')).toHaveStyle({
      width: layout.width,
      height: layout.height,
    });
  });

  it('a pop cover opens the pop; a deleted pop is a plaque that does nothing', async () => {
    const pop: MessageAttachment = {
      ...video,
      id: 'att-pop',
      popId: 'pop-1',
      popChannelId: 'channel-1',
      width: 720,
      height: 1280,
    };
    const popLayout = computeMosaicLayout([pop], mosaicBounds(328), 3);
    const onPress = jest.fn();
    const user = userEvent.setup();

    const view = await render(
      <MediaAttachmentGrid attachments={[pop]} layout={popLayout} onPress={onPress} />,
    );

    await user.press(screen.getByTestId('pop-post-cover'));
    expect(onPress).toHaveBeenCalledWith(0, null);

    onPress.mockClear();
    await view.rerender(
      <MediaAttachmentGrid
        attachments={[{ ...pop, popDeleted: true, posterUrl: null, url: '' }]}
        layout={popLayout}
        onPress={onPress}
      />,
    );

    expect(screen.getByText('Поп удалён')).toBeTruthy();
    expect(screen.queryByTestId('pop-post-cover')).toBeNull();
    await user.press(screen.getByTestId('pop-post-deleted'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
