/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { ALL_REACTIONS, PRIMARY_REACTIONS } from './reactionSet';

// Набор — инвариант базы: реакцию не из справочника она отвергнет. Клиентский
// список обязан с ним совпадать, иначе в меню окажется кнопка, которая всегда
// падает, или реакция, которую нельзя поставить.
function migrationSet() {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/20260930100000_reactions.sql'),
    'utf8',
  );
  const rows = [...sql.matchAll(/\('([^']+)', (\d+), (true|false)\)/g)].map((match) => ({
    emoji: match[1],
    position: Number(match[2]),
    primary: match[3] === 'true',
  }));

  return rows.sort((a, b) => a.position - b.position);
}

describe('reaction set', () => {
  it('matches the database reference table, in order', () => {
    const rows = migrationSet();

    expect(PRIMARY_REACTIONS).toEqual(rows.filter((row) => row.primary).map((row) => row.emoji));
    expect(ALL_REACTIONS).toEqual(rows.map((row) => row.emoji));
  });

  it('keeps seven primary reactions, each once', () => {
    expect(PRIMARY_REACTIONS).toHaveLength(7);
    expect(new Set(ALL_REACTIONS).size).toBe(ALL_REACTIONS.length);
  });
});
