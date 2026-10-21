// Схема базы для клиента — сгенерированная (`types.gen.ts`) с одной
// поправкой. Колонки представлений генератор размечает nullable целиком, а у
// `message_rows` пустыми бывают только поля, пустые и у `messages`, плюс время
// (скрыто от смотрящего — null). Без поправки каждое чтение сообщения
// обрастало бы проверками на null у id, номера и счётчиков.

import type { Database as Generated } from '@/api/types.gen';

type MessageRowsView = Generated['public']['Views']['message_rows'];

/** Колонки `message_rows`, которые и правда бывают null. */
type NullableMessageColumns =
  | 'author_id'
  | 'text'
  | 'created_at'
  | 'edited_at'
  | 'edit_mark'
  | 'read_at'
  | 'deleted_at'
  | 'stream_id'
  | 'system_event'
  | 'system_user_id'
  | 'source_chat_id'
  | 'forwarded_comment_id'
  // Вычисляемые связи.
  | 'my_reaction'
  | 'my_stream_participation'
  | 'reactors';

type MessageRow = {
  [K in keyof MessageRowsView['Row']]: K extends NullableMessageColumns
    ? MessageRowsView['Row'][K]
    : NonNullable<MessageRowsView['Row'][K]>;
};

export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Views'> & {
    Views: Omit<Generated['public']['Views'], 'message_rows'> & {
      message_rows: Omit<MessageRowsView, 'Row'> & { Row: MessageRow };
    };
  };
};
