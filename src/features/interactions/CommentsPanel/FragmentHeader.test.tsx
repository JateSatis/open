import { act, fireEvent, screen } from '@testing-library/react-native';

import { FragmentHeader } from './FragmentHeader';

import { listMessageFragments, setFragmentReaction, type Fragment } from '@/api/fragments';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));

const mockedList = jest.mocked(listMessageFragments);
const mockedSet = jest.mocked(setFragmentReaction);
const range = { start: 0, end: 9, text: 'Самойлова' };
const subject = {
  kind: 'fragment' as const,
  key: 'm1:0-9',
  fragmentId: 'f1',
  range,
  focusInput: false,
};

function fragment(overrides: Partial<Fragment> = {}): Fragment {
  return {
    id: 'f1',
    messageId: 'm1',
    authorId: 'me',
    start: 0,
    end: 9,
    exactText: 'Самойлова',
    lost: false,
    memberReactions: { '❤️': 1 },
    visitorReactions: { '🔥': 2 },
    reactionsCount: 3,
    commentsCount: 0,
    clusterId: null,
    mine: '🔥',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'me' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedSet.mockResolvedValue({ fragmentId: 'f1', mine: null });
});

async function renderHeader() {
  await renderWithQuery(
    <FragmentHeader messageId="m1" fragment={subject} amMember={false} width={360} />,
  );
  await act(async () => undefined);
}

describe('fragment panel header', () => {
  it('quotes the fragment and shows its reactions of both rows together, most first', async () => {
    mockedList.mockResolvedValue([fragment()]);

    await renderHeader();

    expect(screen.getByTestId('fragment-quote')).toHaveTextContent('Самойлова');
    expect(await screen.findByLabelText('Снять реакцию 🔥')).toBeTruthy();
    expect(screen.getByLabelText('Реакция ❤️, 1')).toBeTruthy();
  });

  it('a tap on my reaction takes it off, a tap on another one puts it instead', async () => {
    mockedList.mockResolvedValue([fragment()]);

    await renderHeader();
    await act(async () => fireEvent.press(await screen.findByLabelText('Снять реакцию 🔥')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', range, null);

    await act(async () => fireEvent.press(screen.getByLabelText('Реакция ❤️, 1')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', range, '❤️');
  });

  it('offers the whole set behind «+» — even before the fragment has any reaction', async () => {
    mockedList.mockResolvedValue([]);

    await renderHeader();
    await act(async () => fireEvent.press(screen.getByLabelText('Все реакции')));
    await act(async () => fireEvent.press(screen.getByTestId('reaction-option-👍')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', range, '👍');
  });

  it('shows only my fragment of this range — not someone else’s on the same words', async () => {
    mockedList.mockResolvedValue([fragment({ id: 'f2', authorId: 'other', mine: null })]);

    await renderHeader();

    expect(screen.queryByLabelText(/Реакция 🔥/)).toBeNull();
  });
});
