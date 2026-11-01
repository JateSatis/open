import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChatThreadActionRow } from './ChatThreadActionRow';
import { ChatThreadFooter } from './ChatThreadFooter';
import type { useChatThreadActions } from './useChatThreadActions';

import { ChatThreadsToggle } from '@/features/chats/ChatThreadsToggle';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/chats/MessageComposer', () => ({ MessageComposer: () => null }));
jest.mock('@/features/chats/EditAttachments', () => ({ EditAttachments: () => null }));
jest.mock('@/features/chats/MediaPickerSheet', () => ({
  MediaPickerSheet: () => null,
  armMediaSheet: jest.fn(), openMediaSheet: jest.fn(), releaseMediaSheetArm: jest.fn(),
}));

describe('ChatThreadsToggle', () => {
  it('в обычном виде ведёт в «Треды», в «Тредах» — обратно', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<ChatThreadsToggle active={false} onPress={onPress} />);

    await fireEvent.press(screen.getByLabelText('Треды'));
    expect(onPress).toHaveBeenCalledTimes(1);

    await rerender(<ChatThreadsToggle active onPress={onPress} />);
    expect(screen.getByLabelText('Обычный вид')).toBeTruthy();
  });
});

describe('ChatThreadActionRow', () => {
  it('разрыв длинного треда догружает пропущенное', async () => {
    const onPress = jest.fn();

    await render(<ChatThreadActionRow type="gap" hidden={7} loading={false} onPress={onPress} />);
    await fireEvent.press(screen.getByText('Показать ещё 7 ответов'));

    expect(onPress).toHaveBeenCalled();
  });

  it('тред не загрузился — повтор', async () => {
    const onRetry = jest.fn();

    await render(<ChatThreadActionRow type="loading" failed onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Не удалось загрузить тред. Повторить'));

    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ChatThreadFooter', () => {
  it('постороннему писать в тред некуда — поля ввода нет', async () => {
    const actions = {
      selection: { isActive: false, selected: [] },
    } as unknown as ReturnType<typeof useChatThreadActions>;

    await render(
      <ChatThreadFooter
        actions={actions}
        currentUserId="visitor"
        isMember={false}
        title="Группа"
        onTyping={jest.fn()}
        onRecordingVoice={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('chat-thread-footer')).toBeNull();
    expect(screen.queryByPlaceholderText('Ответить в треде')).toBeNull();
  });
});
