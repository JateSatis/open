import { requestClient } from '@/api/requestClient';
import { screen, userEvent } from '@testing-library/react-native';

import { ReportSheet } from '.';

import { isBlockedByMe, reportUser } from '@/api/blocks';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({}));
jest.mock('@/api/blocks', () => ({
  reportUser: jest.fn(),
  isBlockedByMe: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
}));

const mockedReport = reportUser as jest.MockedFunction<typeof reportUser>;
const mockedIsBlocked = isBlockedByMe as jest.MockedFunction<typeof isBlockedByMe>;
const target = { userId: 'user-2', name: 'Марина', chatId: 'chat-9' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedReport.mockResolvedValue(undefined);
  mockedIsBlocked.mockResolvedValue(false);
});

describe('ReportSheet', () => {
  it('К3.3 по умолчанию заодно блокирует и так и говорит в итоге', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<ReportSheet target={target} onClose={jest.fn()} />);
    await user.press(await screen.findByText('Домогательства'));
    await user.type(screen.getByLabelText('Комментарий к жалобе'), 'пишет каждый день');
    // После блокировки статус перечитается как «заблокирован» — итог не должен смениться.
    mockedIsBlocked.mockResolvedValue(true);
    await user.press(screen.getByText('Пожаловаться и заблокировать'));

    expect(await screen.findByText('Жалоба отправлена')).toBeTruthy();
    expect(await screen.findByText('Спасибо. Марина заблокирован(а).')).toBeTruthy();
    expect(mockedReport).toHaveBeenCalledWith({
      userId: 'user-2',
      reason: 'harassment',
      chatId: 'chat-9',
      comment: 'пишет каждый день',
      block: true,
    }, requestClient());
  });

  it('уже заблокированного не предлагает блокировать ещё раз', async () => {
    mockedIsBlocked.mockResolvedValue(true);

    await renderWithQuery(<ReportSheet target={target} onClose={jest.fn()} />);

    expect(await screen.findByText('Пожаловаться')).toBeTruthy();
    expect(screen.queryByTestId('report-also-block')).toBeNull();
  });

  it('лимит жалоб — понятный текст', async () => {
    mockedReport.mockRejectedValue(Object.assign(new Error('x'), { code: 'OPN12' }));
    const user = userEvent.setup();

    await renderWithQuery(<ReportSheet target={target} onClose={jest.fn()} />);
    await user.press(await screen.findByText('Спам'));
    await user.press(screen.getByTestId('report-send'));

    expect(await screen.findByText('Слишком много жалоб. Попробуйте позже.')).toBeTruthy();
  });

  it('без цели ничего не рисует', async () => {
    await renderWithQuery(<ReportSheet target={null} onClose={jest.fn()} />);

    expect(screen.queryByText(/Пожаловаться/)).toBeNull();
  });
});
