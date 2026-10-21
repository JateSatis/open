export type ReportTarget = {
  userId: string;
  name: string;
  /** Заявка на диалог, на которую жалуются; без неё — жалоба на профиль. */
  chatId?: string | null;
};
