import { create } from 'zustand';

// Ссылка, открытая до входа (`openger://c/<имя>` без сессии): после входа
// приложение ведёт по ней, а не в «Чаты». Живёт в памяти: закрыли приложение
// на экране входа — ссылка забыта, как и в других мессенджерах.

type PendingLinkState = {
  href: string | null;
};

const usePendingLinkStore = create<PendingLinkState>(() => ({
  href: null,
}));

export function setPendingLink(href: string | null) {
  usePendingLinkStore.setState({ href });
}

export function getPendingLink(): string | null {
  return usePendingLinkStore.getState().href;
}
