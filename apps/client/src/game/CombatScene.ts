import {
  BATTLEFIELD_CELLS,
  EXIT_CELL,
  type Cell,
  type CombatOrder,
  type CombatState,
  type CombatWeaponShot,
  type ShipWeapon,
  cellDistance,
  sameCell
} from "@hex-space/shared";
import Phaser from "phaser";

export type CombatSceneBridge = {
  onCellSelected(cell: Cell): void;
};

type RenderCell = {
  cell: Cell;
  center: Phaser.Math.Vector2;
  polygon: Phaser.Geom.Polygon;
};
type CombatInputTool =
  | {
      type: "move";
    }
  | {
      type: "weapon";
      weaponId: string;
    };
type CellVisualState =
  | "selected"
  | "shotTarget"
  | "weaponReachable"
  | "exit"
  | "moveReachable"
  | "default";
type CellStyleContext = {
  selected: boolean;
  shotTarget: boolean;
  weaponReachable: boolean;
  isExit: boolean;
  moveReachable: boolean;
  weapon?: ShipWeapon;
};
type CellStyle = {
  fillColor: number;
  fillAlpha: number;
  lineColor: number;
  lineAlpha: number;
  lineWidth: number;
};
type CellStylePreset = Omit<CellStyle, "fillColor"> & {
  fillColor: number | "weapon";
};
type UnitBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
};

const CANVAS_WIDTH = 1040;
const CANVAS_HEIGHT = 620;
const BOARD_PADDING_X = 48;
const BOARD_PADDING_Y = 42;
const UNIT_HEX_WIDTH = Math.sqrt(3);
const UNIT_HEX_VERTICAL_STEP = 1.5;
const BOARD_UNIT_BOUNDS = createBoardUnitBounds();
const HEX_SIZE = calculateFittedHexSize();
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_VERTICAL_STEP = HEX_SIZE * 1.5;
const BOARD_ORIGIN_X = calculateBoardOriginX();
const BOARD_ORIGIN_Y = calculateBoardOriginY();
const CELL_STYLE_BY_STATE: Record<CellVisualState, CellStylePreset> = {
  selected: {
    fillColor: 0x4cc9f0,
    fillAlpha: 0.7,
    lineColor: 0x3a4f66,
    lineAlpha: 0.8,
    lineWidth: 1.2
  },
  shotTarget: {
    fillColor: "weapon",
    fillAlpha: 0.5,
    lineColor: 0x3a4f66,
    lineAlpha: 0.8,
    lineWidth: 1.2
  },
  weaponReachable: {
    fillColor: "weapon",
    fillAlpha: 0.24,
    lineColor: 0x3a4f66,
    lineAlpha: 0.8,
    lineWidth: 1.2
  },
  exit: {
    fillColor: 0x2fbf71,
    fillAlpha: 0.72,
    lineColor: 0x9cf2bd,
    lineAlpha: 0.8,
    lineWidth: 1.2
  },
  moveReachable: {
    fillColor: 0x243d55,
    fillAlpha: 0.78,
    lineColor: 0x3a4f66,
    lineAlpha: 0.8,
    lineWidth: 1.2
  },
  default: {
    fillColor: 0x111a27,
    fillAlpha: 0.58,
    lineColor: 0x3a4f66,
    lineAlpha: 0.8,
    lineWidth: 1.2
  }
};

export function createCombatGame(parent: HTMLElement, bridge: CombatSceneBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: "#07111f",
    scale: {
      mode: Phaser.Scale.NONE
    },
    scene: new CombatScene(bridge),
    render: {
      antialias: true
    }
  });
}

class CombatScene extends Phaser.Scene {
  private readonly bridge: CombatSceneBridge;
  private gridGraphics?: Phaser.GameObjects.Graphics;
  private routeGraphics?: Phaser.GameObjects.Graphics;
  private shipGraphics?: Phaser.GameObjects.Graphics;
  private hoverCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private activeTool: CombatInputTool = { type: "move" };
  private hoveredWeaponId: string | null = null;
  private showCellCoordinates = false;
  private plannedShots: CombatWeaponShot[] = [];
  private pendingOrder: CombatOrder | null = null;
  private combatState: CombatState | null = null;
  private inputLocked = false;
  private renderCells: RenderCell[] = [];
  private gridLabels: Phaser.GameObjects.Text[] = [];
  private activeShipTweens: Phaser.Tweens.Tween[] = [];
  private movingShipIds = new Set<string>();
  private shipRenderPositions = new Map<string, Phaser.Math.Vector2>();

  constructor(bridge: CombatSceneBridge) {
    super("combat");
    this.bridge = bridge;
  }

  create(): void {
    this.gridGraphics = this.add.graphics();
    this.routeGraphics = this.add.graphics();
    this.shipGraphics = this.add.graphics();
    this.gridGraphics.setDepth(1);
    this.routeGraphics.setDepth(3);
    this.shipGraphics.setDepth(4);
    this.renderCells = BATTLEFIELD_CELLS.map((cell) => {
      const center = cellToCenter(cell);
      return {
        cell,
        center,
        polygon: new Phaser.Geom.Polygon(hexPoints(center))
      };
    });

    this.drawStars();
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.hoverCell = this.pickCell(pointer.x, pointer.y);
      this.renderScene();
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.inputLocked) {
        return;
      }

      const cell = this.pickCell(pointer.x, pointer.y);

      if (cell && this.isSelectableCell(cell)) {
        this.bridge.onCellSelected(cell);
        this.renderScene();
      }
    });

    this.game.events.on("combat-state", (state: CombatState) => {
      const previousState = this.combatState;
      this.combatState = state;
      this.syncShipRenderPositions(previousState, state);
      this.renderScene();
    });
    this.game.events.on("combat-selected-cell", (cell: Cell | null) => {
      this.selectedCell = cell;
      this.renderScene();
    });
    this.game.events.on("combat-pending-order", (order: CombatOrder | null) => {
      this.pendingOrder = order;
      this.renderScene();
    });
    this.game.events.on("combat-active-tool", (tool: CombatInputTool) => {
      this.activeTool = tool;
      this.renderScene();
    });
    this.game.events.on("combat-hovered-weapon", (weaponId: string | null) => {
      this.hoveredWeaponId = weaponId;
      this.renderScene();
    });
    this.game.events.on("combat-planned-shots", (shots: CombatWeaponShot[]) => {
      this.plannedShots = shots;
      this.renderScene();
    });
    this.game.events.on("combat-coordinate-labels", (showCellCoordinates: boolean) => {
      this.showCellCoordinates = showCellCoordinates;
      this.renderScene();
    });
    this.game.events.on("combat-input-locked", (locked: boolean) => {
      this.inputLocked = locked;
      this.renderScene();
    });

    this.renderScene();
  }

  private renderScene(): void {
    this.clearGridLabels();

    this.gridGraphics?.clear();
    this.routeGraphics?.clear();
    this.drawGrid();
    this.drawPlannedActions();
    this.renderShipsLayer();
  }

  private renderShipsLayer(): void {
    this.shipGraphics?.clear();
    this.drawShips();
  }

  private clearGridLabels(): void {
    this.gridLabels.forEach((label) => label.destroy());
    this.gridLabels = [];
  }

  private syncShipRenderPositions(
    previousState: CombatState | null,
    nextState: CombatState
  ): void {
    const shouldResetPositions =
      !previousState ||
      previousState.id !== nextState.id ||
      nextState.turn <= previousState.turn;

    if (shouldResetPositions) {
      this.stopShipTweens();
      this.shipRenderPositions = createShipPositionMap(nextState);
      return;
    }

    const shouldAnimate =
      previousState.phase === "resolving" &&
      nextState.phase !== "resolving" &&
      nextState.turn > previousState.turn;

    if (!shouldAnimate) {
      this.shipRenderPositions = createShipPositionMap(nextState);
      return;
    }

    this.animateShipMovement(previousState, nextState);
  }

  private animateShipMovement(previousState: CombatState, nextState: CombatState): void {
    this.stopShipTweens();

    const nextShipIds = new Set(nextState.ships.map((ship) => ship.id));

    for (const shipId of [...this.shipRenderPositions.keys()]) {
      if (!nextShipIds.has(shipId)) {
        this.shipRenderPositions.delete(shipId);
      }
    }

    for (const ship of nextState.ships) {
      const previousShip = previousState.ships.find((item) => item.id === ship.id);
      const finalCenter = cellToCenter(ship.cell);

      if (!previousShip || sameCell(previousShip.cell, ship.cell)) {
        if (isVisibleShip(ship.hp, ship.escaped)) {
          this.shipRenderPositions.set(ship.id, finalCenter);
        }

        continue;
      }

      const startCenter =
        this.shipRenderPositions.get(ship.id)?.clone() ?? cellToCenter(previousShip.cell);
      const distance = cellDistance(previousShip.cell, ship.cell);
      const duration = Phaser.Math.Clamp(160 + distance * 95, 240, 720);

      this.shipRenderPositions.set(ship.id, startCenter);
      this.movingShipIds.add(ship.id);

      const tween = this.tweens.add({
        targets: startCenter,
        x: finalCenter.x,
        y: finalCenter.y,
        duration,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          this.renderShipsLayer();
        },
        onComplete: () => {
          startCenter.set(finalCenter.x, finalCenter.y);
          this.movingShipIds.delete(ship.id);
          this.activeShipTweens = this.activeShipTweens.filter((item) => item !== tween);

          if (isVisibleShip(ship.hp, ship.escaped)) {
            this.shipRenderPositions.set(ship.id, startCenter);
          } else {
            this.shipRenderPositions.delete(ship.id);
          }

          this.renderShipsLayer();
        }
      });

      this.activeShipTweens.push(tween);
    }
  }

  private stopShipTweens(): void {
    for (const tween of this.activeShipTweens) {
      tween.remove();
    }

    this.activeShipTweens = [];
    this.movingShipIds.clear();
  }

  private drawStars(): void {
    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 0.55);

    for (let index = 0; index < 180; index += 1) {
      const x = Phaser.Math.Between(0, CANVAS_WIDTH);
      const y = Phaser.Math.Between(0, CANVAS_HEIGHT);
      const radius = Phaser.Math.Between(1, 2);
      stars.fillCircle(x, y, radius);
    }
  }

  private drawGrid(): void {
    const graphics = this.gridGraphics;

    if (!graphics) {
      return;
    }

    let hoveredCell: RenderCell | undefined;
    const previewWeapon = this.getPreviewWeapon();

    for (const renderCell of this.renderCells) {
      const moveReachable = this.isReachableByPlayer(renderCell.cell);
      const weaponReachable = Boolean(
        previewWeapon && this.isWeaponReachable(renderCell.cell, previewWeapon)
      );
      const selected = Boolean(
        this.activeTool.type === "move" &&
          this.selectedCell &&
          sameCell(renderCell.cell, this.selectedCell)
      );
      const shotTarget = this.plannedShots.some((shot) => sameCell(shot.targetCell, renderCell.cell));
      const shotTargetWeapon = this.getShotTargetWeapon(renderCell.cell);
      const hovered = this.hoverCell && sameCell(renderCell.cell, this.hoverCell);
      const isExit = sameCell(renderCell.cell, EXIT_CELL);
      const cellStyle = resolveCellStyle({
        selected,
        shotTarget,
        weaponReachable,
        isExit,
        moveReachable,
        weapon: shotTargetWeapon ?? previewWeapon
      });

      if (hovered) {
        hoveredCell = renderCell;
      }

      graphics.fillStyle(cellStyle.fillColor, cellStyle.fillAlpha);
      graphics.lineStyle(cellStyle.lineWidth, cellStyle.lineColor, cellStyle.lineAlpha);
      tracePolygon(graphics, renderCell.polygon.points);
      graphics.fillPath();
      graphics.strokePath();

      if (isExit) {
        this.gridLabels.push(
          this.add
            .text(renderCell.center.x, renderCell.center.y, "EXIT", {
              color: "#06140c",
              fontFamily: "Arial",
              fontSize: "10px",
              fontStyle: "700"
            })
            .setDepth(2)
            .setOrigin(0.5)
        );
      }

      if (this.showCellCoordinates) {
        this.drawCellCoordinateLabel(renderCell);
      }
    }

    if (hoveredCell) {
      graphics.lineStyle(2.4, 0xf5b942, 1);
      tracePolygon(graphics, hoveredCell.polygon.points);
      graphics.strokePath();
    }
  }

  private drawShips(): void {
    const graphics = this.shipGraphics;

    if (!graphics || !this.combatState) {
      return;
    }

    for (const ship of this.combatState.ships) {
      if (!isVisibleShip(ship.hp, ship.escaped) && !this.movingShipIds.has(ship.id)) {
        continue;
      }

      const center = this.shipRenderPositions.get(ship.id) ?? cellToCenter(ship.cell);
      const color = ship.side === "A" ? 0x4cc9f0 : 0xff6b6b;
      const nose = ship.side === "A" ? center.x + 13 : center.x - 13;

      graphics.fillStyle(color, 1);
      graphics.lineStyle(2, 0xffffff, 0.85);
      graphics.beginPath();
      graphics.moveTo(nose, center.y);
      graphics.lineTo(center.x - Math.sign(nose - center.x) * 10, center.y - 10);
      graphics.lineTo(center.x - Math.sign(nose - center.x) * 10, center.y + 10);
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();
    }
  }

  private drawCellCoordinateLabel(renderCell: RenderCell): void {
    const label = formatCellCoordinate(renderCell.cell);
    const offsetY = getCoordinateLabelOffsetY(renderCell.cell);

    this.gridLabels.push(
      this.add
        .text(renderCell.center.x, renderCell.center.y + offsetY, label, {
          color: "#d6dee8",
          fontFamily: "Arial",
          fontSize: "11px",
          fontStyle: "700",
          stroke: "#06111f",
          strokeThickness: 2
        })
        .setAlpha(0.64)
        .setDepth(2)
        .setOrigin(0.5)
    );
  }

  private drawPlannedActions(): void {
    const graphics = this.routeGraphics;
    const player = this.combatState?.ships.find(
      (ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped
    );

    if (!graphics || !player) {
      return;
    }

    const moveTarget = this.pendingOrder?.moveTo ?? this.selectedCell;
    const shots = this.pendingOrder?.shots ?? this.plannedShots;

    if (moveTarget && !sameCell(player.cell, moveTarget)) {
      this.drawMoveLine(graphics, player.cell, moveTarget);
    }

    for (const shot of shots) {
      const weapon = player.weapons.find((item) => item.id === shot.weaponId);

      if (weapon) {
        this.drawShotLine(graphics, player.cell, shot.targetCell, weapon);
      }
    }
  }

  private drawMoveLine(graphics: Phaser.GameObjects.Graphics, fromCell: Cell, targetCell: Cell): void {
    const from = cellToCenter(fromCell);
    const to = cellToCenter(targetCell);
    const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
    const start = pointOnRay(from, angle, 18);
    const end = pointOnRay(to, angle + Math.PI, 18);

    graphics.lineStyle(7, 0x06111f, 0.78);
    graphics.beginPath();
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(end.x, end.y);
    graphics.strokePath();

    graphics.lineStyle(3, 0xf5b942, 0.95);
    graphics.beginPath();
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(end.x, end.y);
    graphics.strokePath();

    drawArrowHead(graphics, end, angle, 12, 0xf5b942);
  }

  private drawShotLine(
    graphics: Phaser.GameObjects.Graphics,
    fromCell: Cell,
    targetCell: Cell,
    weapon: ShipWeapon
  ): void {
    const from = cellToCenter(fromCell);
    const to = cellToCenter(targetCell);
    const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
    const start = pointOnRay(from, angle, 18);
    const end = pointOnRay(to, angle + Math.PI, 12);

    graphics.lineStyle(5, 0x06111f, 0.74);
    graphics.beginPath();
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(end.x, end.y);
    graphics.strokePath();

    graphics.lineStyle(2.5, weapon.color, 0.96);
    graphics.beginPath();
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(end.x, end.y);
    graphics.strokePath();

    graphics.fillStyle(weapon.color, 0.18);
    graphics.fillCircle(to.x, to.y, HEX_SIZE * 0.56);
    graphics.lineStyle(2, weapon.color, 0.9);
    graphics.strokeCircle(to.x, to.y, HEX_SIZE * 0.56);
  }

  private getActiveWeapon(): ShipWeapon | undefined {
    if (this.activeTool.type !== "weapon") {
      return undefined;
    }

    const weaponId = this.activeTool.weaponId;
    const player = this.combatState?.ships.find(
      (ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped
    );

    return player?.weapons.find((weapon) => weapon.id === weaponId);
  }

  private getPreviewWeapon(): ShipWeapon | undefined {
    if (this.hoveredWeaponId) {
      return this.getPlayerWeapon(this.hoveredWeaponId);
    }

    return this.getActiveWeapon();
  }

  private getPlayerWeapon(weaponId: string): ShipWeapon | undefined {
    const player = this.combatState?.ships.find(
      (ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped
    );

    return player?.weapons.find((weapon) => weapon.id === weaponId);
  }

  private getShotTargetWeapon(cell: Cell): ShipWeapon | undefined {
    const shots = this.pendingOrder?.shots ?? this.plannedShots;
    const shot = shots.find((item) => sameCell(item.targetCell, cell));

    if (!shot) {
      return undefined;
    }

    return this.getPlayerWeapon(shot.weaponId);
  }

  private isWeaponReachable(cell: Cell, weapon: ShipWeapon): boolean {
    const player = this.combatState?.ships.find(
      (ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped
    );

    return Boolean(
      player &&
        !this.inputLocked &&
        this.combatState?.phase === "planning" &&
        cellDistance(player.cell, cell) <= weapon.range
    );
  }

  private isSelectableCell(cell: Cell): boolean {
    if (this.activeTool.type === "move") {
      return this.isReachableByPlayer(cell);
    }

    const weapon = this.getActiveWeapon();

    return Boolean(weapon && this.isWeaponReachable(cell, weapon));
  }

  private pickCell(x: number, y: number): Cell | null {
    return this.renderCells.find((renderCell) => Phaser.Geom.Polygon.Contains(renderCell.polygon, x, y))
      ?.cell ?? null;
  }

  private isReachableByPlayer(cell: Cell): boolean {
    if (this.inputLocked || this.combatState?.phase !== "planning") {
      return false;
    }

    const player = this.combatState?.ships.find(
      (ship) => ship.side === "A" && ship.hp > 0 && !ship.escaped
    );

    return Boolean(player && cellDistance(player.cell, cell) <= player.speed);
  }
}

function cellToCenter(cell: Cell): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(
    BOARD_ORIGIN_X + cell.col * HEX_WIDTH + (cell.row % 2 === 1 ? HEX_WIDTH / 2 : 0),
    BOARD_ORIGIN_Y + cell.row * HEX_VERTICAL_STEP
  );
}

function createBoardUnitBounds(): UnitBounds {
  const centerBounds = BATTLEFIELD_CELLS.reduce(
    (bounds, cell) => {
      const center = cellToUnitCenter(cell);

      return {
        minX: Math.min(bounds.minX, center.x),
        maxX: Math.max(bounds.maxX, center.x),
        minY: Math.min(bounds.minY, center.y),
        maxY: Math.max(bounds.maxY, center.y)
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    }
  );
  const minX = centerBounds.minX - UNIT_HEX_WIDTH / 2;
  const maxX = centerBounds.maxX + UNIT_HEX_WIDTH / 2;
  const minY = centerBounds.minY - 1;
  const maxY = centerBounds.maxY + 1;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function cellToUnitCenter(cell: Cell): { x: number; y: number } {
  return {
    x: cell.col * UNIT_HEX_WIDTH + getOddRowOffset(cell.row),
    y: cell.row * UNIT_HEX_VERTICAL_STEP
  };
}

function getOddRowOffset(row: number): number {
  if (row % 2 === 1) {
    return UNIT_HEX_WIDTH / 2;
  }

  return 0;
}

function calculateFittedHexSize(): number {
  const availableWidth = CANVAS_WIDTH - BOARD_PADDING_X * 2;
  const availableHeight = CANVAS_HEIGHT - BOARD_PADDING_Y * 2;
  const horizontalSize = availableWidth / BOARD_UNIT_BOUNDS.width;
  const verticalSize = availableHeight / BOARD_UNIT_BOUNDS.height;

  return Math.min(horizontalSize, verticalSize);
}

function calculateBoardOriginX(): number {
  const boardWidth = BOARD_UNIT_BOUNDS.width * HEX_SIZE;
  const leftPadding = (CANVAS_WIDTH - boardWidth) / 2;

  return leftPadding - BOARD_UNIT_BOUNDS.minX * HEX_SIZE;
}

function calculateBoardOriginY(): number {
  const boardHeight = BOARD_UNIT_BOUNDS.height * HEX_SIZE;
  const topPadding = (CANVAS_HEIGHT - boardHeight) / 2;

  return topPadding - BOARD_UNIT_BOUNDS.minY * HEX_SIZE;
}

function formatCellCoordinate(cell: Cell): string {
  return `${rowLabelFromIndex(cell.row)}:${cell.col + 1}`;
}

function rowLabelFromIndex(index: number): string {
  let value = index;
  let label = "";

  do {
    const remainder = value % 26;
    label = `${String.fromCharCode(65 + remainder)}${label}`;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return label;
}

function getCoordinateLabelOffsetY(cell: Cell): number {
  if (sameCell(cell, EXIT_CELL)) {
    return 12;
  }

  return 0;
}

function hexPoints(center: Phaser.Math.Vector2): Phaser.Math.Vector2[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Phaser.Math.DegToRad(60 * index - 30);
    return new Phaser.Math.Vector2(
      center.x + HEX_SIZE * Math.cos(angle),
      center.y + HEX_SIZE * Math.sin(angle)
    );
  });
}

function tracePolygon(graphics: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[]): void {
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);

  for (const point of points.slice(1)) {
    graphics.lineTo(point.x, point.y);
  }

  graphics.closePath();
}

function pointOnRay(
  origin: Phaser.Math.Vector2,
  angle: number,
  distance: number
): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(
    origin.x + Math.cos(angle) * distance,
    origin.y + Math.sin(angle) * distance
  );
}

function drawArrowHead(
  graphics: Phaser.GameObjects.Graphics,
  point: Phaser.Math.Vector2,
  angle: number,
  size: number,
  color: number
): void {
  const left = pointOnRay(point, angle + Math.PI * 0.78, size);
  const right = pointOnRay(point, angle - Math.PI * 0.78, size);

  graphics.fillStyle(color, 0.95);
  graphics.beginPath();
  graphics.moveTo(point.x, point.y);
  graphics.lineTo(left.x, left.y);
  graphics.lineTo(right.x, right.y);
  graphics.closePath();
  graphics.fillPath();
}

function resolveCellStyle(context: CellStyleContext): CellStyle {
  const state = resolveCellVisualState(context);
  const preset = CELL_STYLE_BY_STATE[state];

  if (preset.fillColor === "weapon" && context.weapon) {
    return {
      ...preset,
      fillColor: context.weapon.color
    };
  }

  if (preset.fillColor === "weapon") {
    const defaultPreset = CELL_STYLE_BY_STATE.default;

    return {
      fillColor: 0x111a27,
      fillAlpha: defaultPreset.fillAlpha,
      lineColor: defaultPreset.lineColor,
      lineAlpha: defaultPreset.lineAlpha,
      lineWidth: defaultPreset.lineWidth
    };
  }

  return {
    ...preset,
    fillColor: preset.fillColor
  };
}

function resolveCellVisualState(context: CellStyleContext): CellVisualState {
  if (context.selected) {
    return "selected";
  }

  if (context.shotTarget) {
    return "shotTarget";
  }

  if (context.weaponReachable) {
    return "weaponReachable";
  }

  if (context.isExit) {
    return "exit";
  }

  if (context.moveReachable) {
    return "moveReachable";
  }

  return "default";
}

function createShipPositionMap(state: CombatState): Map<string, Phaser.Math.Vector2> {
  return new Map(
    state.ships
      .filter((ship) => isVisibleShip(ship.hp, ship.escaped))
      .map((ship) => [ship.id, cellToCenter(ship.cell)])
  );
}

function isVisibleShip(hp: number, escaped: boolean): boolean {
  return hp > 0 && !escaped;
}
