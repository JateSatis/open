import { acquireChatTopic } from './chatTopics';

type Handler = (message: { payload: unknown }) => void;

const mockChannels = new Map<string, Map<string, Handler>>();

jest.mock('@/api/supabase', () => ({
  supabase: {
    realtime: { setAuth: jest.fn(() => Promise.resolve()) },
    removeChannel: jest.fn(),
    channel: jest.fn((topic: string) => {
      const handlers = new Map<string, Handler>();
      const channel = {
        on: (_type: string, { event }: { event: string }, handler: Handler) => {
          handlers.set(event, handler);
          return channel;
        },
        subscribe: () => channel,
        send: jest.fn(),
      };

      mockChannels.set(topic, handlers);
      return channel;
    }),
  },
}));

function emit(topic: string, event: string, payload: unknown) {
  mockChannels.get(topic)?.get(event)?.({ payload });
}

describe('chatTopics', () => {
  it('сигналы о неопубликованном для зрителей приходят участнику из топика участников', () => {
    const onMessage = jest.fn();
    const onReactionsChanged = jest.fn();
    const onPinsChanged = jest.fn();
    const topic = acquireChatTopic('c1', { onMessage, onReactionsChanged, onPinsChanged }, true);

    emit('chat-members:c1', 'new_message', { message_id: 'm1' });
    emit('chat-members:c1', 'reactions_changed', { message_id: 'm1' });
    emit('chat-members:c1', 'pins_changed', {});

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onReactionsChanged).toHaveBeenCalledWith('m1');
    expect(onPinsChanged).toHaveBeenCalledTimes(1);

    // Общий топик — те же события.
    emit('chat:c1', 'reactions_changed', { message_id: 'm2' });
    expect(onReactionsChanged).toHaveBeenLastCalledWith('m2');

    topic.release();
  });

  it('зритель топик участников не открывает', () => {
    const topic = acquireChatTopic('c2', { onMessage: jest.fn() });

    expect(mockChannels.has('chat:c2')).toBe(true);
    expect(mockChannels.has('chat-members:c2')).toBe(false);
    topic.release();
  });
});
