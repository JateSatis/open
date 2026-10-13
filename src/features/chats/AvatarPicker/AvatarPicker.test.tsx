import { act, render, screen, userEvent } from '@testing-library/react-native';

import { AvatarPicker, type AvatarPickerProps } from '.';

import { openMediaSheet } from '@/features/chats/MediaPickerSheet';
import type { PreparedAvatar } from '@/features/media';

// Шит аватарки — свой тест; здесь — что круг открывает его и что делает с итогом.
let sheetDone: ((avatar: Promise<PreparedAvatar>) => void) | null = null;

jest.mock('@/features/chats/MediaPickerSheet', () => ({ openMediaSheet: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet/MediaAvatarSheet', () => ({
  MediaAvatarSheet: ({ onDone }: { onDone: (avatar: Promise<PreparedAvatar>) => void }) => {
    sheetDone = onDone;
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  sheetDone = null;
});

const LABELS = { pick: 'Выбрать аватарку канала', change: 'Сменить аватарку канала' };

function Picker(props: Partial<AvatarPickerProps>) {
  return (
    <AvatarPicker
      owner="avatar:channel"
      labels={LABELS}
      uri={null}
      onChange={jest.fn()}
      {...props}
    />
  );
}

describe('AvatarPicker', () => {
  it('тап по кругу открывает шит аватарки канала', async () => {
    const user = userEvent.setup();

    await render(<Picker />);
    await user.press(screen.getByLabelText('Выбрать аватарку канала'));

    expect(openMediaSheet).toHaveBeenCalledWith('avatar:channel');
  });

  it('«Готово» в шите ставит подготовленное фото в круг формы', async () => {
    const onChange = jest.fn();

    await render(<Picker onChange={onChange} />);
    await act(async () => sheetDone?.(Promise.resolve({ uri: 'file:///avatar.jpg', size: 512 })));

    expect(onChange).toHaveBeenCalledWith('file:///avatar.jpg');
  });

  it('фото, которое не подготовилось, объясняет и форму не трогает', async () => {
    const onChange = jest.fn();

    await render(<Picker onChange={onChange} />);
    await act(async () => sheetDone?.(Promise.reject(new Error('decode'))));

    expect(screen.getByText('Не удалось открыть фото. Выберите другое.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('притушенный круг не открывает шит, но показывает выбранное фото', async () => {
    const user = userEvent.setup();

    await render(<Picker uri="file:///g.jpg" idle testID="group-avatar-picker" />);
    await user.press(screen.getByLabelText('Сменить аватарку канала'));

    expect(openMediaSheet).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-avatar-picker-preview')).toBeTruthy();
    expect(screen.getByLabelText('Сменить аватарку канала')).toBeDisabled();
  });
});
