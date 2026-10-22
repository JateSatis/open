// Схема базы для клиента — сгенерированная (`types.gen.ts`) с одной
// поправкой. Колонки представлений генератор размечает nullable целиком, а у
// представлений «глазами смотрящего» пустыми бывают только поля, пустые и у
// таблицы под ними, плюс то, что скрыто от смотрящего (время, люди удалённых
// аккаунтов). Без поправки каждое чтение обрастало бы проверками на null у
// id, номера и счётчиков.

import type { Database as Generated } from '@/api/types.gen';

type Views = Generated['public']['Views'];

/** Строка представления: nullable только перечисленные колонки. */
type Strict<View extends { Row: object }, Nullable extends PropertyKey> = Omit<View, 'Row'> & {
  Row: {
    [K in keyof View['Row']]: K extends Nullable ? View['Row'][K] : NonNullable<View['Row'][K]>;
  };
};

/** Колонки `message_rows`, которые и правда бывают null. */
type NullableMessageColumns =
  | 'author_id'
  | 'author_name'
  | 'author_avatar_url'
  | 'text'
  | 'created_at'
  | 'edited_at'
  | 'edit_mark'
  | 'read_at'
  | 'deleted_at'
  | 'stream_id'
  | 'stream_host_id'
  | 'system_event'
  | 'system_user_id'
  | 'system_user_name'
  | 'source_chat_id'
  | 'forwarded_comment_id'
  // Вычисляемые связи.
  | 'my_reaction'
  | 'my_stream_participation'
  | 'reactors';

/** Колонки `comment_rows`, которые бывают null. */
type NullableCommentColumns =
  | 'message_id'
  | 'author_id'
  | 'author_name'
  | 'author_avatar_url'
  | 'text'
  | 'edited_at'
  | 'deleted_at'
  | 'thread_root_id'
  | 'pop_id'
  | 'target_id'
  | 'fragment_id'
  | 'rank'
  | 'my_reaction'
  | 'reactors';

/** Колонки `chat_rows`, которые бывают null. */
type NullableChatColumns =
  | 'title'
  | 'username'
  | 'avatar_url'
  | 'description'
  | 'owner_id'
  | 'created_by'
  | 'last_message_author_id'
  | 'deleted_at'
  // Вычисляемые поля.
  | 'last_message_at'
  | 'last_message_preview'
  | 'chat_display_name'
  | 'chat_read_up_to'
  | 'chat_am_member';

/** Колонки `reactor_rows`, которые бывают null: человек удалённого аккаунта. */
type NullableReactorColumns = 'user_id' | 'display_name' | 'avatar_url';

export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Views'> & {
    Views: Omit<Views, 'message_rows' | 'comment_rows' | 'chat_rows' | 'reactor_rows'> & {
      message_rows: Strict<Views['message_rows'], NullableMessageColumns>;
      comment_rows: Strict<Views['comment_rows'], NullableCommentColumns>;
      chat_rows: Strict<Views['chat_rows'], NullableChatColumns>;
      reactor_rows: Strict<Views['reactor_rows'], NullableReactorColumns>;
    };
  };
};
