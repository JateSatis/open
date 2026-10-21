import type { Visibility } from '@/api/privacy';

export const VISIBILITY_OPTIONS: readonly Visibility[] = ['everyone', 'friends', 'nobody'];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  everyone: 'Все',
  friends: 'Только друзья',
  nobody: 'Никто',
};
