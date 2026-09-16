/**
 * Product limits, not data invariants: they shape what the UI offers and how
 * much traffic a message costs, and they are expected to change. Schema-level
 * invariants (such as "a voice message is exactly one attachment") live in the
 * migration instead — see CLAUDE.md, «инварианты данных живут в схеме».
 *
 * None of this is a security boundary: the client can be bypassed, so anything
 * that must hold is enforced by the database or by Storage policies.
 */
export const MediaLimits = {
  voice: {
    maxDurationMs: 5 * 60_000,
    /** Below this a tap is a slip of the finger, not a message. */
    minDurationMs: 700,
  },
  videoNote: {
    maxDurationMs: 60_000,
    /** Rendered inside a circle, so a square source is all we ever show. */
    sizePx: 480,
  },
  photo: {
    /** Enough for a full-screen view on a 3x phone, a fraction of the bytes. */
    maxWidthPx: 1600,
    /** JPEG quality after the resize. */
    quality: 0.7,
  },
  video: {
    maxDurationMs: 5 * 60_000,
  },
  gallery: {
    maxSelection: 10,
  },
} as const;

/** Single public bucket; write access is scoped by the `{userId}/` prefix. */
export const MEDIA_BUCKET = 'media';
