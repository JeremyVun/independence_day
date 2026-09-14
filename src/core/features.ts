// Local feature switches. A query param (`?canopy=1`) wins, then localStorage (`feature.canopy` = '1'), then the default.
const params = new URLSearchParams(location.search);

function flag(key: string, fallback: boolean): boolean {
  const q = params.get(key);
  if (q !== null) return q !== '0' && q !== 'false';
  const stored = localStorage.getItem(`feature.${key}`);
  return stored === null ? fallback : stored === '1';
}

export const features = {
  canopy: flag('canopy', false),
};
