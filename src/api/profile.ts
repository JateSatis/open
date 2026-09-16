// Signatures only — no implementation yet. Placeholder types until
// src/api/types.gen.ts exists (generated after the first migration).

export type Profile = {
  id: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
};

export type ProfileUpdateInput = Partial<Pick<Profile, 'displayName' | 'bio' | 'avatarUrl'>>;

export function getProfile(userId: string): Promise<Profile> {
  throw new Error('Not implemented');
}

export function getMyProfile(): Promise<Profile> {
  throw new Error('Not implemented');
}

export function updateMyProfile(input: ProfileUpdateInput): Promise<Profile> {
  throw new Error('Not implemented');
}
