import { QueryClient } from '@tanstack/react-query';

import { sendFragmentReaction } from './fragmentReactions';
import { fragmentsKey, readMessageFragments } from './useMessageFragments';

import { setFragmentReaction, type Fragment } from '@/api/fragments';
import { showNotice } from '@/features/notifications/alertsStore';

jest.mock('@/features/notifications/alertsStore', () => ({ showNotice: jest.fn() }));

const mockedSet = jest.mocked(setFragmentReaction);
const range = { start: 4, end: 27, text: 'какой-то другой уровень' };
let messageId = 'm0';
let base = { messageId, range, audience: 'visitor' as const, me: 'me' };

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<{ fragmentId: string | null; mine: null }>((ok, fail) => {
    resolve = () => ok({ fragmentId: 'f1', mine: null });
    reject = fail;
  });

  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

let queryClient: QueryClient;

let run = 0;

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient();
  // Очередь отправки живёт в модуле: у каждого теста — своё сообщение.
  run += 1;
  messageId = `m${run}`;
  base = { messageId, range, audience: 'visitor' as const, me: 'me' };
});

describe('my reaction on a fragment', () => {
  it('shows at once on my fragment of the range, creating it in the cache', () => {
    mockedSet.mockReturnValue(new Promise(() => undefined));

    sendFragmentReaction(queryClient, { ...base, emoji: '🔥' });

    const [mine] = readMessageFragments(queryClient, messageId) ?? [];

    expect(mine).toMatchObject({
      authorId: 'me',
      start: 4,
      end: 27,
      mine: '🔥',
      visitorReactions: { '🔥': 1 },
      reactionsCount: 1,
    });
  });

  it('replaces my previous reaction in the row instead of adding a second one', () => {
    mockedSet.mockReturnValue(new Promise(() => undefined));
    queryClient.setQueryData<Fragment[]>(fragmentsKey(messageId), [
      {
        id: 'f1',
        messageId,
        authorId: 'me',
        start: 4,
        end: 27,
        exactText: range.text,
        lost: false,
        memberReactions: {},
        visitorReactions: { '👍': 2 },
        reactionsCount: 2,
        commentsCount: 0,
        mine: '👍',
        clusterId: null,
      },
    ]);

    sendFragmentReaction(queryClient, { ...base, emoji: '🔥' });

    expect(readMessageFragments(queryClient, messageId)?.[0]).toMatchObject({
      visitorReactions: { '👍': 1, '🔥': 1 },
      reactionsCount: 2,
      mine: '🔥',
    });
  });

  it('takes my reaction off my other fragment of the same cluster at once', () => {
    mockedSet.mockReturnValue(new Promise(() => undefined));

    const fragment = (
      id: string,
      start: number,
      end: number,
      mine: string | null,
      clusterId: string,
    ): Fragment => ({
      id,
      messageId,
      authorId: 'me',
      start,
      end,
      exactText: 'x'.repeat(end - start),
      lost: false,
      memberReactions: {},
      visitorReactions: mine ? { [mine]: 1 } : {},
      reactionsCount: mine ? 1 : 0,
      commentsCount: 1,
      mine,
      clusterId,
    });

    queryClient.setQueryData<Fragment[]>(fragmentsKey(messageId), [
      fragment('old', 0, 27, '🔥', 'k1'),
      fragment('mine', 4, 27, null, 'k1'),
      fragment('far', 100, 110, '👍', 'k2'),
    ]);

    sendFragmentReaction(queryClient, { ...base, emoji: '🤣' });

    const byId = new Map(
      (readMessageFragments(queryClient, messageId) ?? []).map((f) => [f.id, f]),
    );

    expect(byId.get('mine')).toMatchObject({ mine: '🤣', visitorReactions: { '🤣': 1 } });
    expect(byId.get('old')).toMatchObject({ mine: null, visitorReactions: {}, reactionsCount: 0 });
    // Другой кластер — не трогается.
    expect(byId.get('far')).toMatchObject({ mine: '👍' });
  });

  it('guesses the cluster of a new fragment by the cached fragments it overlaps', () => {
    mockedSet.mockReturnValue(new Promise(() => undefined));
    queryClient.setQueryData<Fragment[]>(fragmentsKey(messageId), [
      {
        id: 'old',
        messageId,
        authorId: 'me',
        start: 0,
        end: 20,
        exactText: 'x'.repeat(20),
        lost: false,
        memberReactions: {},
        visitorReactions: { '🔥': 1 },
        reactionsCount: 1,
        commentsCount: 0,
        mine: '🔥',
        clusterId: 'k1',
      },
    ]);

    // Мой фрагмент 4–27 ещё не в кеше: база положит его в k1.
    sendFragmentReaction(queryClient, { ...base, emoji: '🤣' });

    const byId = new Map(
      (readMessageFragments(queryClient, messageId) ?? []).map((f) => [f.id, f]),
    );

    expect(byId.get('old')).toMatchObject({ mine: null });
  });

  it('keeps one request in flight and sends only the last choice after it', async () => {
    const first = deferred();

    mockedSet.mockReturnValueOnce(first.promise).mockResolvedValue({ fragmentId: 'f1', mine: null });

    sendFragmentReaction(queryClient, { ...base, emoji: '🔥' });
    sendFragmentReaction(queryClient, { ...base, emoji: '👍' });
    sendFragmentReaction(queryClient, { ...base, emoji: null });

    expect(mockedSet).toHaveBeenCalledTimes(1);

    first.resolve();
    await flush();
    await flush();

    expect(mockedSet).toHaveBeenCalledTimes(2);
    expect(mockedSet).toHaveBeenLastCalledWith(messageId, range, null);
  });

  it('says so in human words when the network is gone, and the cache goes back to the server', async () => {
    mockedSet.mockRejectedValue(new TypeError('Network request failed'));
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    sendFragmentReaction(queryClient, { ...base, emoji: '🔥' });
    await flush();

    expect(showNotice).toHaveBeenCalledWith('Не удалось поставить реакцию: нет связи', 'error');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fragmentsKey(messageId) });
  });
});
