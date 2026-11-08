// Shared heading index for repository Markdown (ATX headings, fenced code blocks).
export function docSections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const used = new Set();
  let fence;
  for (const [line, value] of lines.entries()) {
    const marker = value.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const match = value.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const title = match[2];
    const base = title
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '')
      .replace(/\s/g, '-');
    let id = base;
    for (let suffix = 1; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    headings.push({ id, title, level: match[1].length, line });
  }
  for (const [index, heading] of headings.entries()) {
    heading.end =
      headings.slice(index + 1).find((next) => next.level <= heading.level)?.line ?? lines.length;
  }
  return { lines, headings };
}
