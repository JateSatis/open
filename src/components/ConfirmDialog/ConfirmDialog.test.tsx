import { render, screen, userEvent } from '@testing-library/react-native';

import { ConfirmDialogHost, confirm } from '.';
import { resetConfirmDialogQueue } from './store';

beforeEach(() => {
  resetConfirmDialogQueue();
});

describe('ConfirmDialog', () => {
  it('renders nothing until something asks for confirmation', async () => {
    await render(<ConfirmDialogHost />);

    expect(screen.queryByTestId('confirm-dialog-backdrop')).toBeNull();
  });

  it('resolves true when the confirm button is pressed', async () => {
    await render(<ConfirmDialogHost />);

    const pending = confirm({
      title: 'Отменить выбор файлов?',
      message: 'Выбранные фото и видео не будут отправлены.',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    expect(await screen.findByText('Отменить выбор файлов?')).toBeTruthy();
    expect(screen.getByText('Выбранные фото и видео не будут отправлены.')).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByText('Сбросить'));

    expect(await pending).toBe(true);
    expect(screen.queryByText('Отменить выбор файлов?')).toBeNull();
  });

  it('resolves false when the cancel button is pressed', async () => {
    await render(<ConfirmDialogHost />);

    const pending = confirm({
      title: 'Отменить выбор файлов?',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
    });

    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByText('Отмена'));

    expect(await pending).toBe(false);
  });

  it('resolves false when the backdrop is pressed', async () => {
    await render(<ConfirmDialogHost />);

    const pending = confirm({
      title: 'Отменить выбор файлов?',
      confirmLabel: 'Сбросить',
      cancelLabel: 'Отмена',
    });

    await screen.findByText('Отменить выбор файлов?');

    const user = userEvent.setup();
    await user.press(screen.getByTestId('confirm-dialog-backdrop'));

    expect(await pending).toBe(false);
  });

  it('queues a second request until the first is answered', async () => {
    await render(<ConfirmDialogHost />);

    const first = confirm({ title: 'Первый', confirmLabel: 'Да', cancelLabel: 'Нет' });
    const second = confirm({ title: 'Второй', confirmLabel: 'Да', cancelLabel: 'Нет' });

    await screen.findByText('Первый');
    expect(screen.queryByText('Второй')).toBeNull();

    const user = userEvent.setup();
    await user.press(screen.getByText('Да'));

    expect(await first).toBe(true);
    expect(await screen.findByText('Второй')).toBeTruthy();

    await user.press(screen.getByText('Нет'));
    expect(await second).toBe(false);
  });
});
