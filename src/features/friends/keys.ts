export const friendKeys = {
  all: ['friends'] as const,
  status: (userId: string) => [...friendKeys.all, 'status', userId] as const,
  summary: (userId: string) => [...friendKeys.all, 'summary', userId] as const,
  list: (userId: string) => [...friendKeys.all, 'list', userId] as const,
  incoming: () => [...friendKeys.all, 'incoming'] as const,
};
