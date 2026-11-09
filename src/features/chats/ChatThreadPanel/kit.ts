import type {
  ChatRef,
  ChatThreadPerson,
  IslandOriginal,
  Person,
} from '@/api/chats';
import type { HiddenRange } from '@/features/chats/hiddenText';
import type { BubbleRow } from '@/features/chats/islands/rows';
import type { ChatMessage, EditResult, LiveQuote } from '@/features/chats/messages/types';
import type { PinnedMessagesState } from '@/features/chats/usePinnedMessages';
import type { ReactToMessage } from '@/features/interactions/useReactToMessage';
import type { LocalMedia, OutgoingMedia } from '@/features/media';

/**
 * Что шторка треда берёт у переписки: те же люди, отправка, реакции, закрепы
 * Облачка, меню и поле ввода в шторке — те же, что в переписке,
 * только над строками треда.
 */
export type ChatThreadPanelKit = {
  chatId: string;
  /** Чат глазами смотрящего — заголовок островка при пересылке и подпись шита медиа. */
  sourceChat: ChatRef;
  currentUserId: string | null;
  isMember: boolean;
  me: ChatThreadPerson | null;
  peopleById: ReadonlyMap<string, Person>;
  showAvatars: boolean;
  showAuthors: boolean;
  reactions: ReactToMessage;
  pins: Pick<PinnedMessagesState, 'pin' | 'unpin' | 'isPinned'>;
  authorName: (authorId: string | null) => string;
  originalOf: (row: BubbleRow) => IslandOriginal | null;
  openPerson: (personId: string) => void;
  send: (
    text: string,
    media?: OutgoingMedia[],
    replies?: LiveQuote[],
    hidden?: HiddenRange[],
  ) => string | undefined;
  sendVoice: (voice: LocalMedia, replies?: LiveQuote[]) => string;
  retry: (localId: string) => void;
  discard: (localId: string) => void;
  saveEdit: (original: ChatMessage, result: EditResult) => void;
  deleteMessages: (messageIds: string[]) => Promise<void>;
  removeFromIsland: (forwardId: string, messageIds: string[]) => Promise<void>;
  notifyTyping: () => void;
  notifyRecordingVoice: () => void;
};
