import { render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import type { TextInput } from 'react-native';

import { ChatFooter, type ChatFooterProps } from '.';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/chats/MessageComposer', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');

  return { MessageComposer: () => <Text>поле ввода</Text> };
});
jest.mock('@/features/chats/EditAttachments', () => ({ EditAttachments: () => null }));
jest.mock('@/features/chats/MediaPickerSheet', () => ({
  armMediaSheet: jest.fn(),
  openMediaSheet: jest.fn(),
  releaseMediaSheetArm: jest.fn(),
}));

const noop = () => undefined;

const composer: NonNullable<ChatFooterProps['composer']> = {
  text: '',
  onChangeText: noop,
  mode: null,
  onCloseMode: noop,
  canSend: true,
  onSend: noop,
  onTyping: noop,
  onSendVoice: noop,
  onRecordingVoice: noop,
  inputRef: createRef<TextInput>(),
};

const base: ChatFooterProps = {
  selection: {
    isActive: false,
    context: { selected: [], currentUserId: 'me', isMember: true },
    onAction: noop,
  },
  invite: null,
  subscribe: null,
  composer,
};

describe('ChatFooter', () => {
  it('К1.1 после заявки — плашка «Заявка отправлена» вместо поля ввода', async () => {
    await render(<ChatFooter {...base} requestSent composer={null} />);

    expect(screen.getByText('Заявка отправлена')).toBeTruthy();
    expect(screen.getByText('Писать можно, когда собеседник её примет.')).toBeTruthy();
    expect(screen.queryByText('поле ввода')).toBeNull();
  });

  it('в обычном чате — поле ввода', async () => {
    await render(<ChatFooter {...base} />);

    expect(screen.getByText('поле ввода')).toBeTruthy();
    expect(screen.queryByText('Заявка отправлена')).toBeNull();
  });
});
