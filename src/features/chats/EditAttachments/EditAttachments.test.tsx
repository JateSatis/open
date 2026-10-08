import { render, screen } from '@testing-library/react-native';

import { EditAttachments } from '.';

import type { MessageAttachment } from '@/api/chats';

jest.mock('@/features/chats/VoiceMessage', () => ({ VoiceMessage: () => null }));

const popAttachment: MessageAttachment = {
  id: 'att-pop',
  url: 'https://cdn.example/pop.mp4',
  posterUrl: 'https://cdn.example/pop.jpg',
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  durationMs: 6000,
  waveform: null,
  popId: 'pop-1',
};

const noop = () => undefined;

describe('EditAttachments', () => {
  it('keeps the pop of an edited post without a remove button', async () => {
    await render(
      <EditAttachments
        kept={[popAttachment]}
        voice={null}
        onRemoveAttachment={noop}
        onRemoveVoice={noop}
      />,
    );

    expect(screen.getByLabelText('Pop')).toBeTruthy();
    expect(screen.queryByLabelText('Открепить поп')).toBeNull();
    expect(screen.queryByLabelText('Убрать видео')).toBeNull();
  });
});
