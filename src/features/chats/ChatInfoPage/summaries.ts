import { plural } from '@/lib/plural';

// Сводки вкладок для компактного заголовка: «58 фото, 8 видео».

export function mediaSummary(photos: number, videos: number): string {
  return [photos > 0 ? `${photos} фото` : null, videos > 0 ? `${videos} видео` : null]
    .filter(Boolean)
    .join(', ');
}

export function voicesSummary(count: number): string {
  return `${count} ${plural(count, 'голосовое', 'голосовых', 'голосовых')}`;
}

export function membersSummary(count: number): string {
  return `${count} ${plural(count, 'участник', 'участника', 'участников')}`;
}

export function groupsSummary(count: number): string {
  return `${count} ${plural(count, 'общая группа', 'общие группы', 'общих групп')}`;
}
