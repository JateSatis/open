import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaAttachmentGrid } from '.';

import type { MessageAttachment } from '@/api/chats';

const photo: MessageAttachment = {
  id: 'att-1',
  url: 'https://cdn.example/photo.jpg',
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
  durationMs: null,
};

const video: MessageAttachment = {
  id: 'att-2',
  url: 'https://cdn.example/video.mp4',
  mimeType: 'video/mp4',
  width: 800,
  height: 600,
  durationMs: 5000,
};

describe('MediaAttachmentGrid', () => {
  it('reports the tapped tile index so the viewer opens at the right file', async () => {
    const onPress = jest.fn();

    await render(
      <MediaAttachmentGrid attachments={[photo, video]} containerWidth={260} onPress={onPress} />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Открыть видео'));

    expect(onPress).toHaveBeenCalledWith(1);
  });

  it('marks a video tile with its duration so it reads differently from a photo', async () => {
    await render(
      <MediaAttachmentGrid attachments={[photo, video]} containerWidth={260} onPress={jest.fn()} />,
    );

    expect(screen.getByText('0:05')).toBeTruthy();
  });
});
