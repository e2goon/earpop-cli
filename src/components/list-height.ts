// Below this height, menus drop their blank spacer rows so every item fits.
const COMPACT_ROWS = 24;

/** Gap between menu sections for the rows a menu may use. */
export function menuGap(rows: number) {
  return rows < COMPACT_ROWS ? 0 : 1;
}

/** How many list options to show when `reserved` rows go to the menu's other lines. */
export function listHeight({
  rows,
  reserved,
  max,
}: {
  rows: number;
  reserved: number;
  max: number;
}) {
  return Math.max(3, Math.min(max, rows - reserved));
}
