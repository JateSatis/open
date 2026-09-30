/** «N комментариев» по-русски — для кружка у облачка и для шапки панели. */
export function commentsCountLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;

  if (tens >= 11 && tens <= 14) return `${count} комментариев`;
  if (ones === 1) return `${count} комментарий`;
  if (ones >= 2 && ones <= 4) return `${count} комментария`;

  return `${count} комментариев`;
}
