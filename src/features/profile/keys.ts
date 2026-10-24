export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  byId: (userId: string) => [...profileKeys.all, 'byId', userId] as const,
};
