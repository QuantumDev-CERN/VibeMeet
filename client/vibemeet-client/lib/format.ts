
export function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function toPercent(similarity: number | null | undefined): number | null {
  if (similarity == null || Number.isNaN(similarity)) return null;
  return Math.round(similarity * 100);
}
