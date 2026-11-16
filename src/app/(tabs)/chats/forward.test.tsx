import { act, render, screen } from '@testing-library/react-native';

import ForwardRoute from './forward';

import * as drafts from '@/features/chats/composerDraftStore';
import { ForwardSheet } from '@/features/chats/ForwardSheet';
import { original } from '@/test/islands';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/features/chats/ForwardSheet', () => ({ ForwardSheet: jest.fn(() => null) }));
jest.mock('@/features/recs/journal/chatJournal', () => ({
  forwardPickerOpened: jest.fn(),
  forwardPickerClosed: jest.fn(),
}));

const sheet = jest.mocked(ForwardSheet);
const pick = (id: string) => ({
  sourceChat: { id: 'chat-src', name: 'Откуда' },
  items: [{ original: original({ id }) }],
});

beforeEach(() => {
  jest.clearAllMocks();
  drafts.resetComposerDrafts();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('goes back without opening the sheet when there is nothing to forward', async () => {
  await render(<ForwardRoute />);

  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(sheet).not.toHaveBeenCalled();
});

it('completes the pick before going back and keeps the sheet visible until unmount', async () => {
  const selected = pick('sent');
  drafts.startForwardPick(selected);
  const read = jest.spyOn(drafts, 'readForwardPick');
  const complete = jest.spyOn(drafts, 'completeForwardPick');
  const cancel = jest.spyOn(drafts, 'cancelForwardPick');
  mockBack.mockImplementationOnce(() => expect(complete).toHaveBeenCalledTimes(1));
  await render(<ForwardRoute />);

  expect(mockBack).not.toHaveBeenCalled();
  await act(() => sheet.mock.lastCall?.[0].onSent());
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(drafts.useComposerDrafts.getState().forwardPick).toBeNull();

  sheet.mockClear();
  await screen.rerender(<ForwardRoute />);
  expect(sheet.mock.lastCall?.[0].pick).toBe(selected);
  expect(read).toHaveBeenCalledTimes(1);
  expect(mockBack).toHaveBeenCalledTimes(1);

  await screen.unmount();
  expect(cancel).not.toHaveBeenCalled();
});

it('clears an unsent pick on exit and opens with the next selection', async () => {
  const first = pick('first');
  drafts.startForwardPick(first);
  const complete = jest.spyOn(drafts, 'completeForwardPick');
  await render(<ForwardRoute />);
  expect(sheet.mock.lastCall?.[0].pick).toBe(first);

  await screen.unmount();
  expect(drafts.readForwardPick()).toBeNull();
  expect(complete).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();

  const second = pick('second');
  drafts.startForwardPick(second);
  await render(<ForwardRoute />);
  expect(sheet.mock.lastCall?.[0].pick).toBe(second);
});
