import approved from '../../docs/copy/copy-4.json';

// Astra's drafts (copy-1, weapons in copy-3, radio in copy-4) with Jeremy's picks for the title and jet names.
export const copy = approved;

export function jetCopy(id: string): { name: string; blurb: string } {
  const j = (copy.jets as Record<string, { name: string; blurb: string }>)[id];
  return j ?? { name: id, blurb: '' };
}

export const gameTitle = copy.gameTitle;

export const fill = (text: string, value: string | number, key = 'n') => text.replace(`{${key}}`, String(value));
