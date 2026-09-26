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
};

const video: MessageAttachment = {
  id: 'att-2',
  url: 'https://cdn.example/video.mp4',
  posterUrl: 'https://cdn.example/video.jpg',
  mimeType: 'video/mp4',
  width: 800,
  height: 600,
  durationMs: 5000,
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

    expect(onPress).toHaveBeenCalledWith(1);
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
});
