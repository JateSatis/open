/**
 * `m:ss`, growing to `h:mm:ss` only when there are hours — the same shape
 * Telegram uses on voice and video messages.
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const paddedSeconds = String(seconds).padStart(2, '0');

  if (hours === 0) {
    return `${minutes}:${paddedSeconds}`;
  }

  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
}
