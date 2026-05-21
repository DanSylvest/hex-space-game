export type Cell = {
  col: number;
  row: number;
};

export type CubeCell = {
  q: number;
  r: number;
  s: number;
};

export const BATTLEFIELD_WIDTH = 13;
export const BATTLEFIELD_HEIGHT = 9;
export const EXIT_CELL: Cell = {
  col: Math.floor(BATTLEFIELD_WIDTH / 2),
  row: Math.floor(BATTLEFIELD_HEIGHT / 2)
};
export const REMOVED_BATTLEFIELD_CELLS: Cell[] = [
  { col: 0, row: 0 },
  { col: 0, row: BATTLEFIELD_HEIGHT - 1 }
];
export const EXTRA_BATTLEFIELD_CELLS: Cell[] = Array.from(
  { length: BATTLEFIELD_HEIGHT },
  (_, row) => row
)
  .filter(isMiddleEvenRow)
  .map((row) => ({ col: BATTLEFIELD_WIDTH, row }));

export const BATTLEFIELD_CELLS: Cell[] = [
  ...Array.from({ length: BATTLEFIELD_HEIGHT }, (_, row) =>
    Array.from({ length: BATTLEFIELD_WIDTH }, (_, col) => ({ col, row }))
  ).flat(),
  ...EXTRA_BATTLEFIELD_CELLS
].filter(isInsideCell);

const ODD_R_DIRECTIONS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [1, 0],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, 1]
  ],
  [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 1]
  ]
];

export function cellKey(cell: Cell): string {
  return `${cell.col}:${cell.row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function isInsideCell(cell: Cell): boolean {
  return (
    Number.isInteger(cell.col) &&
    Number.isInteger(cell.row) &&
    cell.col >= 0 &&
    cell.row >= 0 &&
    (cell.col < BATTLEFIELD_WIDTH || isExtraBattlefieldCell(cell)) &&
    cell.row < BATTLEFIELD_HEIGHT &&
    !isRemovedBattlefieldCell(cell)
  );
}

export function isRemovedBattlefieldCell(cell: Cell): boolean {
  return REMOVED_BATTLEFIELD_CELLS.some((removedCell) => sameCell(removedCell, cell));
}

export function isExtraBattlefieldCell(cell: Cell): boolean {
  return EXTRA_BATTLEFIELD_CELLS.some((extraCell) => sameCell(extraCell, cell));
}

function isMiddleEvenRow(row: number): boolean {
  if (row === 0) {
    return false;
  }

  if (row === BATTLEFIELD_HEIGHT - 1) {
    return false;
  }

  return row % 2 === 0;
}

export function offsetToCube(cell: Cell): CubeCell {
  const q = cell.col - (cell.row - (cell.row & 1)) / 2;
  const r = cell.row;
  return {
    q,
    r,
    s: -q - r
  };
}

export function cellDistance(a: Cell, b: Cell): number {
  const ac = offsetToCube(a);
  const bc = offsetToCube(b);

  return (
    Math.abs(ac.q - bc.q) +
    Math.abs(ac.r - bc.r) +
    Math.abs(ac.s - bc.s)
  ) / 2;
}

export function neighborsOf(cell: Cell): Cell[] {
  const parity = cell.row & 1;
  return ODD_R_DIRECTIONS[parity]
    .map(([colDelta, rowDelta]) => ({
      col: cell.col + colDelta,
      row: cell.row + rowDelta
    }))
    .filter(isInsideCell);
}

export function reachableCellsFrom(origin: Cell, range: number): Cell[] {
  return BATTLEFIELD_CELLS.filter((cell) => cellDistance(origin, cell) <= range);
}

export function chooseStepToward(from: Cell, to: Cell, maxSteps: number): Cell {
  let current = from;

  for (let step = 0; step < maxSteps; step += 1) {
    const currentDistance = cellDistance(current, to);
    const next = neighborsOf(current)
      .map((cell) => ({
        cell,
        distance: cellDistance(cell, to)
      }))
      .sort((a, b) => a.distance - b.distance || a.cell.row - b.cell.row || a.cell.col - b.cell.col)[0];

    if (!next || next.distance >= currentDistance) {
      return current;
    }

    current = next.cell;
  }

  return current;
}
