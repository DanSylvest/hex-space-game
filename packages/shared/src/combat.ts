import {
  BATTLEFIELD_CELLS,
  BATTLEFIELD_HEIGHT,
  BATTLEFIELD_WIDTH,
  EXIT_CELL,
  type Cell,
  cellDistance,
  cellKey,
  chooseStepToward,
  isInsideCell,
  sameCell
} from "./hex";

export type ShipSide = "A" | "B";

export type CombatPhase = "planning" | "resolving" | "complete";

export type ShipWeapon = {
  id: string;
  name: string;
  range: number;
  damage: number;
  shots: number;
  color: number;
};

export type ShipState = {
  id: string;
  name: string;
  side: ShipSide;
  cell: Cell;
  hp: number;
  maxHp: number;
  speed: number;
  weapons: ShipWeapon[];
  escaped: boolean;
};

export type CombatOrder = {
  shipId: string;
  moveTo: Cell;
  shots: CombatWeaponShot[];
};

export type CombatWeaponShot = {
  weaponId: string;
  targetCell: Cell;
};

export type CombatLogEntry = {
  turn: number;
  text: string;
};

export type CombatDamageEvent = {
  turn: number;
  attackerShipId: string;
  attackerName: string;
  attackerSide: ShipSide;
  targetShipId: string;
  targetName: string;
  targetSide: ShipSide;
  weaponId: string;
  weaponName: string;
  damage: number;
};

export type CombatState = {
  id: string;
  turn: number;
  phase: CombatPhase;
  width: number;
  height: number;
  exitCell: Cell;
  ships: ShipState[];
  log: CombatLogEntry[];
  damageEvents: CombatDamageEvent[];
  winner?: ShipSide;
  updatedAt: number;
};

export type CombatOrderValidation =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

const DEFAULT_SHIP_WEAPONS: ShipWeapon[] = [
  {
    id: "railgun",
    name: "Railgun",
    range: 5,
    damage: 1,
    shots: 1,
    color: 0x4cc9f0
  },
  {
    id: "blaster",
    name: "Blaster",
    range: 2,
    damage: 3,
    shots: 1,
    color: 0xff6b6b
  }
];

const SIDE_A_SPAWN_MAX_COL = Math.max(1, Math.floor(BATTLEFIELD_WIDTH * 0.28));
const SIDE_B_SPAWN_MIN_COL = Math.min(BATTLEFIELD_WIDTH - 1, Math.ceil(BATTLEFIELD_WIDTH * 0.72));

export function createInitialCombatState(id = "demo-combat"): CombatState {
  const spawnCells = createInitialShipCells();

  return {
    id,
    turn: 1,
    phase: "planning",
    width: BATTLEFIELD_WIDTH,
    height: BATTLEFIELD_HEIGHT,
    exitCell: EXIT_CELL,
    ships: [
      {
        id: "scout-a",
        name: "Scout A",
        side: "A",
        cell: spawnCells.A,
        hp: 10,
        maxHp: 10,
        speed: 1,
        weapons: createDefaultShipWeapons(),
        escaped: false
      },
      {
        id: "raider-b",
        name: "Raider B",
        side: "B",
        cell: spawnCells.B,
        hp: 10,
        maxHp: 10,
        speed: 1,
        weapons: createDefaultShipWeapons(),
        escaped: false
      }
    ],
    log: [
      {
        turn: 1,
        text: `Battlefield ${BATTLEFIELD_WIDTH}x${BATTLEFIELD_HEIGHT}; exit at ${cellKey(EXIT_CELL)}.`
      }
    ],
    damageEvents: [],
    updatedAt: Date.now()
  };
}

export function getActiveShip(state: CombatState, side: ShipSide): ShipState | undefined {
  return state.ships.find((ship) => ship.side === side && ship.hp > 0 && !ship.escaped);
}

export function getMaxWeaponRange(ship: ShipState): number {
  return Math.max(0, ...ship.weapons.map((weapon) => weapon.range));
}

function createDefaultShipWeapons(): ShipWeapon[] {
  return DEFAULT_SHIP_WEAPONS.map((weapon) => ({ ...weapon }));
}

function createInitialShipCells(): Record<ShipSide, Cell> {
  const occupiedCells = new Set<string>();
  const sideA = chooseRandomSpawnCell("A", occupiedCells);
  occupiedCells.add(cellKey(sideA));
  const sideB = chooseRandomSpawnCell("B", occupiedCells);

  return {
    A: sideA,
    B: sideB
  };
}

function chooseRandomSpawnCell(side: ShipSide, occupiedCells: Set<string>): Cell {
  const cells = getSpawnCells(side).filter((cell) => !occupiedCells.has(cellKey(cell)));

  if (cells.length === 0) {
    return getFallbackSpawnCell(side);
  }

  return cloneCell(cells[randomIndex(cells.length)]);
}

function getSpawnCells(side: ShipSide): Cell[] {
  if (side === "A") {
    return BATTLEFIELD_CELLS.filter(isSideASpawnCell);
  }

  return BATTLEFIELD_CELLS.filter(isSideBSpawnCell);
}

function isSideASpawnCell(cell: Cell): boolean {
  if (sameCell(cell, EXIT_CELL)) {
    return false;
  }

  return cell.col <= SIDE_A_SPAWN_MAX_COL;
}

function isSideBSpawnCell(cell: Cell): boolean {
  if (sameCell(cell, EXIT_CELL)) {
    return false;
  }

  return cell.col >= SIDE_B_SPAWN_MIN_COL;
}

function getFallbackSpawnCell(side: ShipSide): Cell {
  if (side === "A") {
    return { col: 0, row: EXIT_CELL.row };
  }

  return { col: BATTLEFIELD_WIDTH - 1, row: EXIT_CELL.row };
}

function cloneCell(cell: Cell): Cell {
  return {
    col: cell.col,
    row: cell.row
  };
}

function randomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

export function createResolvingCombatState(state: CombatState): CombatState {
  if (state.phase !== "planning") {
    return state;
  }

  return {
    ...state,
    phase: "resolving",
    updatedAt: Date.now()
  };
}

export function validateCombatOrder(
  state: CombatState,
  side: ShipSide,
  order: CombatOrder
): CombatOrderValidation {
  if (state.phase !== "planning") {
    return {
      ok: false,
      message: "Combat is not accepting orders right now."
    };
  }

  const ship = state.ships.find((item) => item.id === order.shipId);

  if (!ship) {
    return {
      ok: false,
      message: "Ship does not exist."
    };
  }

  if (ship.side !== side) {
    return {
      ok: false,
      message: "Ship belongs to the other side."
    };
  }

  if (ship.hp <= 0 || ship.escaped) {
    return {
      ok: false,
      message: "Ship cannot receive orders."
    };
  }

  if (!isInsideCell(order.moveTo)) {
    return {
      ok: false,
      message: "Move target is outside the battlefield."
    };
  }

  if (cellDistance(ship.cell, order.moveTo) > ship.speed) {
    return {
      ok: false,
      message: "Move target is outside ship speed range."
    };
  }

  const shotsByWeaponId = new Map<string, number>();

  for (const shot of order.shots) {
    const weapon = ship.weapons.find((item) => item.id === shot.weaponId);

    if (!weapon) {
      return {
        ok: false,
        message: "Weapon does not exist on this ship."
      };
    }

    if (!isInsideCell(shot.targetCell)) {
      return {
        ok: false,
        message: "Shot target is outside the battlefield."
      };
    }

    if (cellDistance(ship.cell, shot.targetCell) > weapon.range) {
      return {
        ok: false,
        message: "Shot target is outside weapon range."
      };
    }

    const nextShotCount = (shotsByWeaponId.get(weapon.id) ?? 0) + 1;
    shotsByWeaponId.set(weapon.id, nextShotCount);

    if (nextShotCount > weapon.shots) {
      return {
        ok: false,
        message: "Weapon has no shots left for this turn."
      };
    }
  }

  return {
    ok: true
  };
}

export function createAiOrders(state: CombatState): CombatOrder[] {
  const playerShip = getActiveShip(state, "A");

  return state.ships
    .filter((ship) => ship.side === "B" && ship.hp > 0 && !ship.escaped)
    .map((ship) => {
      const targetCell = playerShip ? playerShip.cell : EXIT_CELL;

      return {
        shipId: ship.id,
        moveTo: chooseStepToward(ship.cell, targetCell, ship.speed),
        shots: createAiShots(ship, playerShip)
      };
    });
}

function createAiShots(ship: ShipState, playerShip: ShipState | undefined): CombatWeaponShot[] {
  if (!playerShip) {
    return [];
  }

  return ship.weapons
    .filter((weapon) => cellDistance(ship.cell, playerShip.cell) <= weapon.range)
    .map((weapon) => ({
      weaponId: weapon.id,
      targetCell: playerShip.cell
    }));
}

export function resolveCombatTurn(state: CombatState, playerOrders: CombatOrder[]): CombatState {
  if (state.phase === "complete") {
    return state;
  }

  const orders = new Map<string, CombatOrder>();

  for (const order of [...playerOrders, ...createAiOrders(state)]) {
    orders.set(order.shipId, order);
  }

  const moveTargets = new Map<string, Cell>();
  const targetCounts = new Map<string, number>();

  for (const ship of state.ships) {
    const target = resolveMoveTarget(ship, orders.get(ship.id));
    moveTargets.set(ship.id, target);
    targetCounts.set(cellKey(target), (targetCounts.get(cellKey(target)) ?? 0) + 1);
  }

  const movedShips = state.ships.map((ship) => {
    if (ship.hp <= 0 || ship.escaped) {
      return ship;
    }

    const target = moveTargets.get(ship.id) ?? ship.cell;
    const collided = targetCounts.get(cellKey(target)) !== 1;
    const cell = collided ? ship.cell : target;

    return {
      ...ship,
      cell,
      escaped: sameCell(cell, EXIT_CELL)
    };
  });

  const damageByShipId = new Map<string, number>();
  const damageEvents: CombatDamageEvent[] = [];

  for (const attacker of movedShips) {
    if (attacker.hp <= 0 || attacker.escaped) {
      continue;
    }

    const order = orders.get(attacker.id);

    if (!order) {
      continue;
    }

    for (const shot of order.shots) {
      const weapon = attacker.weapons.find((item) => item.id === shot.weaponId);

      if (!weapon) {
        continue;
      }

      for (const target of findShotTargets(movedShips, attacker, shot.targetCell)) {
        damageByShipId.set(target.id, (damageByShipId.get(target.id) ?? 0) + weapon.damage);
        damageEvents.push(
          createDamageEvent(state.turn, attacker, target, weapon)
        );
      }
    }
  }

  const damagedShips = movedShips.map((ship) => ({
    ...ship,
    hp: Math.max(0, ship.hp - (damageByShipId.get(ship.id) ?? 0))
  }));

  const winner = resolveWinner(damagedShips);
  const turn = state.turn + 1;

  return {
    ...state,
    turn,
    phase: winner ? "complete" : "planning",
    ships: damagedShips,
    winner,
    log: [
      {
        turn: state.turn,
        text: createTurnLog(state.ships, damagedShips, damageByShipId)
      },
      ...state.log
    ].slice(0, 8),
    damageEvents: [...state.damageEvents, ...damageEvents],
    updatedAt: Date.now()
  };
}

function createDamageEvent(
  turn: number,
  attacker: ShipState,
  target: ShipState,
  weapon: ShipWeapon
): CombatDamageEvent {
  return {
    turn,
    attackerShipId: attacker.id,
    attackerName: attacker.name,
    attackerSide: attacker.side,
    targetShipId: target.id,
    targetName: target.name,
    targetSide: target.side,
    weaponId: weapon.id,
    weaponName: weapon.name,
    damage: weapon.damage
  };
}

function resolveMoveTarget(ship: ShipState, order: CombatOrder | undefined): Cell {
  if (ship.hp <= 0 || ship.escaped || !order || order.shipId !== ship.id) {
    return ship.cell;
  }

  if (!isInsideCell(order.moveTo)) {
    return ship.cell;
  }

  if (cellDistance(ship.cell, order.moveTo) > ship.speed) {
    return ship.cell;
  }

  return order.moveTo;
}

function findShotTargets(
  ships: ShipState[],
  attacker: ShipState,
  targetCell: Cell
): ShipState[] {
  return ships
    .filter(
      (ship) =>
        ship.side !== attacker.side &&
        ship.hp > 0 &&
        !ship.escaped &&
        sameCell(ship.cell, targetCell)
    )
    .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
}

function resolveWinner(ships: ShipState[]): ShipSide | undefined {
  const sideA = ships.some((ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped);
  const sideB = ships.some((ship) => ship.side === "B" && ship.hp > 0 && !ship.escaped);
  const escapedA = ships.some((ship) => ship.side === "A" && ship.escaped);
  const escapedB = ships.some((ship) => ship.side === "B" && ship.escaped);

  if (escapedA) {
    return "A";
  }

  if (escapedB) {
    return "B";
  }

  if (sideA && !sideB) {
    return "A";
  }

  if (sideB && !sideA) {
    return "B";
  }

  return undefined;
}

function createTurnLog(
  before: ShipState[],
  after: ShipState[],
  damageByShipId: Map<string, number>
): string {
  const parts: string[] = [];

  for (const ship of after) {
    const previous = before.find((item) => item.id === ship.id);

    if (previous && !sameCell(previous.cell, ship.cell)) {
      parts.push(`${ship.name} moved to ${cellKey(ship.cell)}`);
    }

    const damage = damageByShipId.get(ship.id) ?? 0;

    if (damage > 0) {
      parts.push(`${ship.name} took ${damage} damage`);
    }

    if (ship.escaped) {
      parts.push(`${ship.name} reached the exit`);
    }
  }

  return parts.length > 0 ? parts.join("; ") : "Both sides held position.";
}
