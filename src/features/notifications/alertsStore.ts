import { create } from 'zustand';

import type { IncomingInvite, IncomingMessage } from '@/api/chats';

/**
 * Короткая фраза: «Скопировано», «Не удалось удалить сообщение». Может нести
 * одно действие — например, «Повторить» у неудавшейся правки.
 */
export type Notice = {
  text: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
};

export type InAppAlert =
  | ({ kind: 'message' } & IncomingMessage)
  | ({ kind: 'invite' } & IncomingInvite)
  | ({ kind: 'notice' } & Notice);

type AlertsState = { alert: InAppAlert | null };

/**
 * Одна карточка поверх приложения на всё: о новом сообщении, о заявке и
 * короткие ответы на действия. Новая вытесняет прежнюю — очередь из
 * устаревших «Скопировано» никому не нужна.
 */
export const useInAppAlert = create<AlertsState>(() => ({ alert: null }));

export function showAlert(alert: InAppAlert) {
  useInAppAlert.setState({ alert });
}

export function showNotice(
  text: string,
  tone: Notice['tone'] = 'info',
  action?: Notice['action'],
) {
  showAlert({ kind: 'notice', text, tone, action });
}

export function dismissAlert() {
  useInAppAlert.setState({ alert: null });
}
