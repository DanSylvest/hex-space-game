import {
  type Cell,
  type CombatOrder,
  type CombatDamageEvent,
  type CombatWeaponShot,
  type ClientMessage,
  type CombatState,
  type ActiveBattleResponse,
  type AuthUser,
  type BattleSummary,
  type BattlesResponse,
  type RegisterResponse,
  type ServerMessage,
  type ShipSide,
  type ShipState,
  type ShipWeapon,
  type StartBattleResponse,
  type StarConnection,
  type StarSystem,
  type SystemPilot,
  type SystemPilotsResponse,
  PLAYER_START_SYSTEM_ID,
  STAR_CONNECTIONS,
  STAR_SYSTEMS,
  cellDistance,
  cellKey,
  createInitialCombatState,
  createResolvingCombatState,
  getActiveShip,
  resolveCombatTurn
} from "@hex-space/shared";
import {
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Phaser from "phaser";
import { createCombatGame } from "./game/CombatScene";

const websocketUrl = import.meta.env.VITE_COMBAT_WS_URL ?? createDefaultWebsocketUrl();
const apiBaseUrl = import.meta.env.VITE_API_URL ?? createDefaultApiBaseUrl();
const registerUrl = import.meta.env.VITE_REGISTER_URL ?? `${apiBaseUrl}/auth/register`;
const localResolveDelayMs = Number(import.meta.env.VITE_LOCAL_RESOLVE_DELAY_MS ?? 550);
const authStorageKey = "hex-space-game:user";

type ConnectionStatus = "connecting" | "connected" | "local";
type PendingOrder = {
  turn: number;
  order: CombatOrder;
};
type AppPage = "world" | "combat";
type CombatInputTool =
  | {
      type: "move";
    }
  | {
      type: "weapon";
      weaponId: string;
    };
type ShipRosterSide = "ally" | "enemy";
type ShipRosterProps = {
  side: ShipRosterSide;
  ships: ShipState[];
};
type ActionModulesProps = {
  ship: ShipState | undefined;
  activeTool: CombatInputTool;
  inputLocked: boolean;
  plannedShotCounts: Map<string, number>;
  onMoveSelect(): void;
  onWeaponSelect(weaponId: string): void;
  onWeaponHover(weaponId: string): void;
  onWeaponLeave(): void;
};
type ShipAvatarProps = {
  ship: ShipState;
};
type RegistrationScreenProps = {
  onRegistered(user: AuthUser): void;
};
type WorldScreenProps = {
  authUser: AuthUser | null;
  selectedSystem: StarSystem | undefined;
  selectedSystemId: string;
  systemBattles: BattleSummary[];
  systemPilots: SystemPilot[];
  activeBattleId: string | null;
  battlesLoading: boolean;
  pilotsLoading: boolean;
  battleNotice: string | null;
  lastCompletedCombat: CombatState | null;
  onSystemSelected(systemId: string): void;
  onStartBattle(): void;
  onOpenBattle(battleId: string): void;
  onAttackPilot(pilotId: string): void;
};
type CombatScreenProps = {
  combatState: CombatState;
  connectionStatus: ConnectionStatus;
  allyShips: ShipState[];
  enemyShips: ShipState[];
  playerShip: ShipState | undefined;
  activeTool: CombatInputTool;
  inputLocked: boolean;
  plannedShotCounts: Map<string, number>;
  gameHostRef: RefObject<HTMLDivElement | null>;
  onMoveSelect(): void;
  onWeaponSelect(weaponId: string): void;
  onWeaponHover(weaponId: string): void;
  onWeaponLeave(): void;
};
type WorldSidePanelProps = {
  authUser: AuthUser | null;
  selectedSystem: StarSystem | undefined;
  activeBattleId: string | null;
};
type CombatSidePanelProps = {
  combatState: CombatState;
  phaseText: string;
  serverNotice: string | null;
  playerShip: ShipState | undefined;
  selectedText: string;
  showCellCoordinates: boolean;
  inputLocked: boolean;
  canSubmit: boolean;
  onCoordinateToggle(): void;
  onSubmitOrder(): void;
  onResetCombat(): void;
};
type WorldMapProps = {
  currentSystemId: string;
  selectedSystemId: string;
  onSystemSelected(systemId: string): void;
};
type WorldMapConnectionProps = {
  connection: StarConnection;
  systemsById: Map<string, StarSystem>;
};
type WorldMapSystemProps = {
  system: StarSystem;
  current: boolean;
  selected: boolean;
  onSelected(systemId: string): void;
};
type SystemBattlePanelProps = {
  system: StarSystem | undefined;
  battles: BattleSummary[];
  activeBattleId: string | null;
  loading: boolean;
  notice: string | null;
  onStartBattle(): void;
  onOpenBattle(battleId: string): void;
};
type SystemPilotPanelProps = {
  currentUserId: string | undefined;
  activeBattleId: string | null;
  pilots: SystemPilot[];
  loading: boolean;
  onAttackPilot(pilotId: string): void;
};
type SystemPilotCardProps = {
  currentUserId: string | undefined;
  activeBattleId: string | null;
  pilot: SystemPilot;
  onAttackPilot(pilotId: string): void;
};
type PilotAction = {
  text: string;
  disabled: boolean;
  className: string;
};
type BattleResultSummaryProps = {
  state: CombatState | null;
};
type DamageTargetRow = {
  targetShipId: string;
  targetName: string;
  damage: number;
};
type DamageTotalRow = {
  attackerShipId: string;
  attackerName: string;
  attackerSide: ShipSide;
  damage: number;
};

const SHIP_COLOR_BY_SIDE: Record<ShipSide, string> = {
  A: "#4cc9f0",
  B: "#ff6b6b"
};

export function App() {
  const gameHostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localResolveTimerRef = useRef<number | null>(null);
  const cellClickHandlerRef = useRef<(cell: Cell) => void>(() => undefined);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => readStoredAuthUser());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [combatState, setCombatState] = useState<CombatState>(() => createInitialCombatState());
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [activeTool, setActiveTool] = useState<CombatInputTool>({ type: "move" });
  const [hoveredWeaponId, setHoveredWeaponId] = useState<string | null>(null);
  const [showCellCoordinates, setShowCellCoordinates] = useState(false);
  const [plannedShots, setPlannedShots] = useState<CombatWeaponShot[]>([]);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState(PLAYER_START_SYSTEM_ID);
  const [systemBattles, setSystemBattles] = useState<BattleSummary[]>([]);
  const [systemPilots, setSystemPilots] = useState<SystemPilot[]>([]);
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);
  const [battleNotice, setBattleNotice] = useState<string | null>(null);
  const [battlesLoading, setBattlesLoading] = useState(false);
  const [pilotsLoading, setPilotsLoading] = useState(false);
  const [lastCompletedCombat, setLastCompletedCombat] = useState<CombatState | null>(null);

  const playerShip = useMemo(() => getActiveShip(combatState, "A"), [combatState]);
  const selectedSystem = useMemo(
    () => STAR_SYSTEMS.find((system) => system.id === selectedSystemId),
    [selectedSystemId]
  );
  const allyShips = useMemo(() => getShipsBySide(combatState, "A"), [combatState]);
  const enemyShips = useMemo(() => getShipsBySide(combatState, "B"), [combatState]);
  const visibleShots = pendingOrder?.order.shots ?? plannedShots;
  const plannedShotCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const shot of visibleShots) {
      counts.set(shot.weaponId, (counts.get(shot.weaponId) ?? 0) + 1);
    }

    return counts;
  }, [visibleShots]);
  const inputLocked = combatState.phase !== "planning" || pendingOrder !== null;
  const canSubmit =
    combatState.phase === "planning" &&
    !inputLocked &&
    playerShip !== undefined &&
    (selectedCell === null || cellDistance(playerShip.cell, selectedCell) <= playerShip.speed);

  cellClickHandlerRef.current = handleCellSelected;

  useEffect(() => {
    if (!authUser || !activeBattleId || !gameHostRef.current || gameRef.current) {
      return;
    }

    gameRef.current = createCombatGame(gameHostRef.current, {
      onCellSelected: (cell) => cellClickHandlerRef.current(cell)
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [authUser, activeBattleId]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-state", combatState);
  }, [combatState]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-selected-cell", selectedCell);
  }, [selectedCell]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-input-locked", inputLocked);
  }, [inputLocked]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-pending-order", pendingOrder?.order ?? null);
  }, [pendingOrder]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-active-tool", activeTool);
  }, [activeTool]);

  useEffect(() => {
    gameRef.current?.events.emit(
      "combat-hovered-weapon",
      getPreviewWeaponId(inputLocked, hoveredWeaponId)
    );
  }, [hoveredWeaponId, inputLocked]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-planned-shots", plannedShots);
  }, [plannedShots]);

  useEffect(() => {
    gameRef.current?.events.emit("combat-coordinate-labels", showCellCoordinates);
  }, [showCellCoordinates]);

  useEffect(() => {
    return () => {
      clearLocalResolveTimer();
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadSystemBattles();
    void loadSystemPilots();
  }, [authUser, selectedSystemId]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void loadActiveBattle();
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !activeBattleId) {
      return;
    }

    const socket = new WebSocket(createCombatWebsocketUrl(activeBattleId));
    wsRef.current = socket;

    socket.onopen = () => {
      setConnectionStatus("connected");
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;

      if (message.type === "combat.snapshot") {
        setCombatState(message.state);
        setSelectedCell(null);

        if (message.state.phase === "complete") {
          leaveCombat(message.state, "Бой завершен. Возврат на карту.");
          return;
        }

        if (message.state.phase !== "resolving") {
          setPendingOrder(null);
          setPlannedShots([]);
          setActiveTool({ type: "move" });
          setHoveredWeaponId(null);
        }
      }

      if (message.type === "combat.ended") {
        leaveCombat(message.state, message.message);
      }

      if (message.type === "combat.orderAccepted") {
        setPendingOrder({
          turn: message.turn,
          order: message.order
        });
        setServerNotice(null);
      }

      if (message.type === "combat.error") {
        setPendingOrder(null);
        setServerNotice(message.message);
      }
    };

    socket.onerror = () => {
      setConnectionStatus("local");
    };

    socket.onclose = () => {
      setConnectionStatus((status) => (status === "connected" ? "local" : status));
    };

    return () => {
      socket.close();
    };
  }, [authUser, activeBattleId]);

  useEffect(() => {
    if (!activeBattleId || combatState.phase !== "complete") {
      return;
    }

    leaveCombat(combatState, "Бой завершен. Возврат на карту.");
  }, [activeBattleId, combatState]);

  function leaveCombat(state: CombatState, message: string): void {
    clearLocalResolveTimer();
    setCombatState(state);
    setPendingOrder(null);
    setServerNotice(null);
    setSelectedCell(null);
    setPlannedShots([]);
    setActiveTool({ type: "move" });
    setHoveredWeaponId(null);
    setBattleNotice(message);
    setActiveBattleId(null);
    setLastCompletedCombat(state);
    setSystemBattles((battles) => battles.filter((battle) => battle.id !== state.id));
    setSystemPilots((pilots) => pilots.map(clearPilotBattle));
  }

  function sendMessage(message: ClientMessage): boolean {
    const socket = wsRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  async function loadSystemBattles(): Promise<void> {
    if (!authUser) {
      return;
    }

    setBattlesLoading(true);

    try {
      const response = await fetch(
        `${apiBaseUrl}/world/systems/${selectedSystemId}/battles?userId=${authUser.id}`
      );
      const result = (await response.json()) as BattlesResponse;
      setSystemBattles(result.battles);
      setActiveBattleId(result.activeBattleId ?? activeBattleId);
    } catch {
      setBattleNotice("Не удалось загрузить список боев.");
    } finally {
      setBattlesLoading(false);
    }
  }

  async function loadSystemPilots(): Promise<void> {
    if (!authUser) {
      return;
    }

    setPilotsLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/world/systems/${selectedSystemId}/pilots`);
      const result = (await response.json()) as SystemPilotsResponse;
      setSystemPilots(result.pilots);
    } catch {
      setSystemPilots([]);
    } finally {
      setPilotsLoading(false);
    }
  }

  async function loadActiveBattle(): Promise<void> {
    if (!authUser) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/world/players/${authUser.id}/active-battle`);
      const result = (await response.json()) as ActiveBattleResponse;

      if (result.ok) {
        setActiveBattleId(result.battle.id);
      }
    } catch {
      setBattleNotice("Не удалось проверить активный бой.");
    }
  }

  function submitOrder(): void {
    if (!playerShip || !canSubmit) {
      return;
    }

    const message: ClientMessage = {
      type: "combat.submitOrder",
      order: {
        shipId: playerShip.id,
        moveTo: selectedCell ?? playerShip.cell,
        shots: plannedShots
      }
    };

    if (!sendMessage(message)) {
      setConnectionStatus("local");
      runLocalResolution(message.order);
      return;
    }

    setPendingOrder({
      turn: combatState.turn,
      order: message.order
    });
    setSelectedCell(null);
    setPlannedShots([]);
    setServerNotice(null);
  }

  function resetCombat(): void {
    clearLocalResolveTimer();
    setPendingOrder(null);
    setServerNotice(null);
    setSelectedCell(null);
    setPlannedShots([]);
    setActiveTool({ type: "move" });
    setHoveredWeaponId(null);

    if (!sendMessage({ type: "combat.reset" })) {
      setCombatState(createInitialCombatState());
      setConnectionStatus("local");
    }
  }

  function runLocalResolution(order: CombatOrder): void {
    clearLocalResolveTimer();
    setPendingOrder({
      turn: combatState.turn,
      order
    });
    setSelectedCell(null);
    setPlannedShots([]);
    setServerNotice(null);
    setCombatState((state) => createResolvingCombatState(state));

    localResolveTimerRef.current = window.setTimeout(() => {
      localResolveTimerRef.current = null;
      setCombatState((state) => resolveCombatTurn(state, [order]));
      setPendingOrder(null);
    }, localResolveDelayMs);
  }

  function clearLocalResolveTimer(): void {
    if (localResolveTimerRef.current === null) {
      return;
    }

    window.clearTimeout(localResolveTimerRef.current);
    localResolveTimerRef.current = null;
  }

  function selectMoveTool(): void {
    setHoveredWeaponId(null);
    setActiveTool({ type: "move" });
  }

  function selectWeaponTool(weaponId: string): void {
    setActiveTool({ type: "weapon", weaponId });
  }

  function handleRegistered(user: AuthUser): void {
    localStorage.setItem(authStorageKey, JSON.stringify(user));
    setAuthUser(user);
  }

  function handleSystemSelected(systemId: string): void {
    setSelectedSystemId(systemId);
    setBattleNotice(null);
  }

  async function startBattle(): Promise<void> {
    if (!authUser) {
      return;
    }

    setBattleNotice(null);
    setLastCompletedCombat(null);

    try {
      const response = await fetch(`${apiBaseUrl}/world/systems/${selectedSystemId}/battles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: authUser.id
        })
      });
      const result = (await response.json()) as StartBattleResponse;

      if (!result.ok) {
        setBattleNotice(result.message);

        if (result.activeBattleId) {
          setActiveBattleId(result.activeBattleId);
        }

        return;
      }

      setActiveBattleId(result.activeBattleId);
      setSystemBattles((battles) => [result.battle, ...battles]);
      setSystemPilots((pilots) => markPilotBattle(pilots, authUser.id, result.activeBattleId));
    } catch {
      setBattleNotice("Не удалось начать бой.");
    }
  }

  function openBattle(battleId: string): void {
    setActiveBattleId(battleId);
    setBattleNotice(null);
    setSystemPilots((pilots) => markPilotBattle(pilots, authUser?.id, battleId));
  }

  async function attackPilot(pilotId: string): Promise<void> {
    if (!authUser) {
      return;
    }

    if (pilotId === authUser.id) {
      setBattleNotice("Нельзя атаковать себя.");
      return;
    }

    setBattleNotice(null);
    setLastCompletedCombat(null);

    try {
      const response = await fetch(`${apiBaseUrl}/world/systems/${selectedSystemId}/battles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: authUser.id,
          targetUserId: pilotId
        })
      });
      const result = (await response.json()) as StartBattleResponse;

      if (!result.ok) {
        setBattleNotice(result.message);

        if (result.activeBattleId) {
          setActiveBattleId(result.activeBattleId);
        }

        return;
      }

      setActiveBattleId(result.activeBattleId);
      setSystemBattles((battles) => [result.battle, ...battles]);
      setSystemPilots((pilots) => markPilotsBattle(pilots, [authUser.id, pilotId], result.activeBattleId));
    } catch {
      setBattleNotice("Не удалось атаковать пилота.");
    }
  }

  function handleCellSelected(cell: Cell): void {
    if (inputLocked || !playerShip) {
      return;
    }

    if (activeTool.type === "move") {
      setSelectedCell(cell);
      setServerNotice(null);
      return;
    }

    const weapon = playerShip.weapons.find((item) => item.id === activeTool.weaponId);

    if (!weapon || cellDistance(playerShip.cell, cell) > weapon.range) {
      return;
    }

    setPlannedShots((shots) => {
      const currentWeaponShots = shots.filter((shot) => shot.weaponId === weapon.id);
      const otherShots = shots.filter((shot) => shot.weaponId !== weapon.id);
      const nextShot = {
        weaponId: weapon.id,
        targetCell: cell
      };

      if (currentWeaponShots.length >= weapon.shots) {
        return [...otherShots, ...currentWeaponShots.slice(1), nextShot];
      }

      return [...shots, nextShot];
    });
    setServerNotice(null);
  }

  const selectedText = selectedCell ? cellKey(selectedCell) : "hold";
  const phaseText = getPhaseText(combatState, pendingOrder);
  const appPage = resolveAppPage(activeBattleId);

  function renderActiveScreen() {
    if (appPage === "combat") {
      return (
        <CombatScreen
          combatState={combatState}
          connectionStatus={connectionStatus}
          allyShips={allyShips}
          enemyShips={enemyShips}
          playerShip={playerShip}
          activeTool={activeTool}
          inputLocked={inputLocked}
          plannedShotCounts={plannedShotCounts}
          gameHostRef={gameHostRef}
          onMoveSelect={selectMoveTool}
          onWeaponSelect={selectWeaponTool}
          onWeaponHover={setHoveredWeaponId}
          onWeaponLeave={() => setHoveredWeaponId(null)}
        />
      );
    }

    return (
      <WorldScreen
        authUser={authUser}
        selectedSystem={selectedSystem}
        selectedSystemId={selectedSystemId}
        systemBattles={systemBattles}
        systemPilots={systemPilots}
        activeBattleId={activeBattleId}
        battlesLoading={battlesLoading}
        pilotsLoading={pilotsLoading}
        battleNotice={battleNotice}
        lastCompletedCombat={lastCompletedCombat}
        onSystemSelected={handleSystemSelected}
        onStartBattle={startBattle}
        onOpenBattle={openBattle}
        onAttackPilot={attackPilot}
      />
    );
  }

  function renderActiveSidePanel() {
    if (appPage === "combat") {
      return (
        <CombatSidePanel
          combatState={combatState}
          phaseText={phaseText}
          serverNotice={serverNotice}
          playerShip={playerShip}
          selectedText={selectedText}
          showCellCoordinates={showCellCoordinates}
          inputLocked={inputLocked}
          canSubmit={canSubmit}
          onCoordinateToggle={() => setShowCellCoordinates((current) => !current)}
          onSubmitOrder={submitOrder}
          onResetCombat={resetCombat}
        />
      );
    }

    return null;
  }

  if (!authUser) {
    return <RegistrationScreen onRegistered={handleRegistered} />;
  }

  return (
    <main className={getAppShellClassName(appPage)}>
      <section className="game-stage" aria-label="Поле боя">
        <div className="game-header">
          <div>
            <h1>Hex Space Game</h1>
            <p>
              Поле {combatState.width}x{combatState.height}; выход в центре{" "}
              {cellKey(combatState.exitCell)}
            </p>
          </div>
          <span className={`status-pill status-${connectionStatus}`}>
            {connectionStatus === "connected" ? "server" : "local demo"}
          </span>
        </div>
        {renderActiveScreen()}
      </section>
      {renderActiveSidePanel()}

      <aside className="side-panel">
        <section className="panel-section">
          <h2>Ход {combatState.turn}</h2>
          <p className="phase-line">{phaseText}</p>
          {serverNotice ? <p className="notice-line">{serverNotice}</p> : null}
        </section>

        <section className="panel-section stat-grid">
          <div>
            <span>Скорость</span>
            <strong>{playerShip?.speed ?? 0}</strong>
          </div>
          <div>
            <span>Выбрано</span>
            <strong>{selectedText}</strong>
          </div>
        </section>

        <section className="panel-section view-tools">
          <h2>View</h2>
          <button
            type="button"
            className={getCoordinateButtonClassName(showCellCoordinates)}
            onClick={() => setShowCellCoordinates((current) => !current)}
          >
            Coords
          </button>
        </section>

        <section className="panel-section action-row">
          <button type="button" disabled={!canSubmit} onClick={submitOrder}>
            {inputLocked ? "Ожидание" : "Отправить ход"}
          </button>
          <button type="button" className="secondary-button" onClick={resetCombat}>
            Сбросить
          </button>
        </section>

        <section className="panel-section">
          <h2>Журнал</h2>
          <ol className="combat-log">
            {combatState.log.map((entry, index) => (
              <li key={`${entry.turn}-${index}`}>
                <span>T{entry.turn}</span>
                {entry.text}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </main>
  );
}

function WorldScreen({
  authUser,
  selectedSystem,
  selectedSystemId,
  systemBattles,
  systemPilots,
  activeBattleId,
  battlesLoading,
  pilotsLoading,
  battleNotice,
  lastCompletedCombat,
  onSystemSelected,
  onStartBattle,
  onOpenBattle,
  onAttackPilot
}: WorldScreenProps) {
  return (
    <section className="screen-stage world-screen" aria-label="World map">
      <div className="world-screen-layout">
        <div className="world-map-column">
          <WorldMap
            currentSystemId={PLAYER_START_SYSTEM_ID}
            selectedSystemId={selectedSystemId}
            onSystemSelected={onSystemSelected}
          />
          <BattleResultSummary state={lastCompletedCombat} />
        </div>
        <SystemBattlePanel
          system={selectedSystem}
          battles={systemBattles}
          activeBattleId={activeBattleId}
          loading={battlesLoading}
          notice={battleNotice}
          onStartBattle={onStartBattle}
          onOpenBattle={onOpenBattle}
        />
        <SystemPilotPanel
          currentUserId={authUser?.id}
          activeBattleId={activeBattleId}
          pilots={systemPilots}
          loading={pilotsLoading}
          onAttackPilot={onAttackPilot}
        />
      </div>
    </section>
  );
}

function CombatScreen({
  combatState,
  connectionStatus,
  allyShips,
  enemyShips,
  playerShip,
  activeTool,
  inputLocked,
  plannedShotCounts,
  gameHostRef,
  onMoveSelect,
  onWeaponSelect,
  onWeaponHover,
  onWeaponLeave
}: CombatScreenProps) {
  return (
    <section className="screen-stage combat-screen" aria-label="Battlefield">
      <div className="game-header">
        <div>
          <h1>Battle</h1>
          <p>
            Поле {combatState.width}x{combatState.height}; выход в центре{" "}
            {cellKey(combatState.exitCell)}
          </p>
        </div>
        <span className={`status-pill status-${connectionStatus}`}>
          {connectionStatus === "connected" ? "server" : "local demo"}
        </span>
      </div>
      <div className="battlefield-layout">
        <ShipRoster
          side="ally"
          ships={allyShips}
        />
        <div className="battlefield-center">
          <div className="game-canvas">
            <div ref={gameHostRef} className="game-canvas-host" />
          </div>
          <ActionModules
            ship={playerShip}
            activeTool={activeTool}
            inputLocked={inputLocked}
            plannedShotCounts={plannedShotCounts}
            onMoveSelect={onMoveSelect}
            onWeaponSelect={onWeaponSelect}
            onWeaponHover={onWeaponHover}
            onWeaponLeave={onWeaponLeave}
          />
        </div>
        <ShipRoster
          side="enemy"
          ships={enemyShips}
        />
      </div>
    </section>
  );
}

export function WorldSidePanel({ authUser, selectedSystem, activeBattleId }: WorldSidePanelProps) {
  return (
    <aside className="side-panel route-side-panel">
      <section className="panel-section">
        <h2>Пилот</h2>
        <p className="phase-line">{getPilotName(authUser)}</p>
      </section>
      <section className="panel-section">
        <h2>Система</h2>
        <p className="phase-line">{getSelectedSystemName(selectedSystem)}</p>
      </section>
      <section className="panel-section">
        <h2>Бой</h2>
        <p className="phase-line">{getActiveBattleText(activeBattleId)}</p>
      </section>
    </aside>
  );
}

function CombatSidePanel({
  combatState,
  phaseText,
  serverNotice,
  playerShip,
  selectedText,
  showCellCoordinates,
  inputLocked,
  canSubmit,
  onCoordinateToggle,
  onSubmitOrder,
  onResetCombat
}: CombatSidePanelProps) {
  return (
    <aside className="side-panel route-side-panel">
      <section className="panel-section">
        <h2>Ход {combatState.turn}</h2>
        <p className="phase-line">{phaseText}</p>
        {serverNotice ? <p className="notice-line">{serverNotice}</p> : null}
      </section>
      <section className="panel-section stat-grid">
        <div>
          <span>Скорость</span>
          <strong>{playerShip?.speed ?? 0}</strong>
        </div>
        <div>
          <span>Выбрано</span>
          <strong>{selectedText}</strong>
        </div>
      </section>
      <section className="panel-section view-tools">
        <h2>View</h2>
        <button
          type="button"
          className={getCoordinateButtonClassName(showCellCoordinates)}
          onClick={onCoordinateToggle}
        >
          Coords
        </button>
      </section>
      <section className="panel-section action-row">
        <button type="button" disabled={!canSubmit} onClick={onSubmitOrder}>
          {getSubmitButtonText(inputLocked)}
        </button>
        <button type="button" className="secondary-button" onClick={onResetCombat}>
          Сбросить
        </button>
      </section>
      <section className="panel-section">
        <h2>Журнал</h2>
        <ol className="combat-log">
          {combatState.log.map((entry, index) => (
            <li key={`${entry.turn}-${index}`}>
              <span>T{entry.turn}</span>
              {entry.text}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

function WorldMap({ currentSystemId, selectedSystemId, onSystemSelected }: WorldMapProps) {
  const systemsById = useMemo(() => createSystemsById(), []);
  const currentSystem = systemsById.get(currentSystemId);

  return (
    <section className="world-map-panel" aria-label="Star map">
      <div className="world-map-header">
        <div>
          <h2>Звездная карта</h2>
          <p>{getCurrentSystemText(currentSystem)}</p>
        </div>
        <span className="world-map-count">{STAR_SYSTEMS.length} systems</span>
      </div>
      <div className="world-map-frame">
        <svg className="world-map-svg" viewBox="0 0 100 64" role="img">
          <defs>
            <radialGradient id="systemGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f5d76e" stopOpacity="0.34" />
              <stop offset="44%" stopColor="#8d5cff" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#8d5cff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="currentSystemGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff0a6" stopOpacity="0.5" />
              <stop offset="38%" stopColor="#f5c84b" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#f5c84b" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect className="world-map-space" width="100" height="64" rx="2" />
          <g className="world-map-stars" aria-hidden="true">
            <circle cx="12" cy="10" r="0.24" />
            <circle cx="22" cy="48" r="0.18" />
            <circle cx="38" cy="13" r="0.2" />
            <circle cx="57" cy="57" r="0.22" />
            <circle cx="73" cy="8" r="0.18" />
            <circle cx="91" cy="29" r="0.24" />
            <circle cx="14" cy="58" r="0.18" />
            <circle cx="63" cy="27" r="0.2" />
            <circle cx="86" cy="47" r="0.18" />
          </g>
          <g>
            {STAR_CONNECTIONS.map((connection) => (
              <WorldMapConnection
                key={`${connection.from}-${connection.to}`}
                connection={connection}
                systemsById={systemsById}
              />
            ))}
          </g>
          <g>
            {STAR_SYSTEMS.map((system) => (
              <WorldMapSystem
                key={system.id}
                system={system}
                current={system.id === currentSystemId}
                selected={system.id === selectedSystemId}
                onSelected={onSystemSelected}
              />
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}

function BattleResultSummary({ state }: BattleResultSummaryProps) {
  if (!state) {
    return null;
  }

  const damageEvents = getCombatDamageEvents(state);
  const playerDamageRows = createPlayerDamageRows(damageEvents);
  const totalRows = createDamageTotalRows(damageEvents);

  return (
    <section className="battle-result-panel">
      <div className="battle-result-header">
        <div>
          <h2>Summary</h2>
          <p>{getBattleResultTitle(state)}</p>
        </div>
        <span>{getBattleResultTurnText(state)}</span>
      </div>
      <div className="battle-result-grid">
        <section className="battle-result-block">
          <h3>Урон игрока</h3>
          {playerDamageRows.length === 0 ? <p className="damage-empty">Игрок не нанес урона.</p> : null}
          {playerDamageRows.map((row) => (
            <div className="damage-target-row" key={row.targetShipId}>
              <span>{row.targetName}</span>
              <strong>{row.damage}</strong>
            </div>
          ))}
        </section>
        <section className="battle-result-block">
          <h3>Общий урон</h3>
          {totalRows.length === 0 ? <p className="damage-empty">Урона в бою не было.</p> : null}
          {totalRows.length > 0 ? <DamageTotalTable rows={totalRows} /> : null}
        </section>
      </div>
    </section>
  );
}

function DamageTotalTable({ rows }: { rows: DamageTotalRow[] }) {
  return (
    <table className="damage-total-table">
      <thead>
        <tr>
          <th>Корабль</th>
          <th>Сторона</th>
          <th>Урон</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.attackerShipId}>
            <td>{row.attackerName}</td>
            <td>{row.attackerSide}</td>
            <td>{row.damage}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorldMapConnection({ connection, systemsById }: WorldMapConnectionProps) {
  const from = systemsById.get(connection.from);
  const to = systemsById.get(connection.to);

  if (!from || !to) {
    return null;
  }

  return (
    <line
      className="world-map-link"
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
    />
  );
}

function WorldMapSystem({ system, current, selected, onSelected }: WorldMapSystemProps) {
  return (
    <g
      className={getWorldSystemClassName(current, selected)}
      role="button"
      tabIndex={0}
      onClick={() => onSelected(system.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          onSelected(system.id);
        }
      }}
    >
      <title>{`${system.name} - ${system.region}, security ${system.security.toFixed(1)}`}</title>
      <circle className="world-system-glow" cx={system.x} cy={system.y} r={getWorldSystemGlowRadius(current)} />
      <circle className="world-system-core" cx={system.x} cy={system.y} r={getWorldSystemCoreRadius(current)} />
      <text className="world-system-label" x={system.x + 2.4} y={system.y - 2.2}>
        {system.name}
      </text>
    </g>
  );
}

function createSystemsById(): Map<string, StarSystem> {
  return new Map(STAR_SYSTEMS.map((system) => [system.id, system]));
}

function getCurrentSystemText(system: StarSystem | undefined): string {
  if (!system) {
    return "Текущая система не найдена";
  }

  return `Текущая система: ${system.name}, ${system.region}`;
}

function getWorldSystemClassName(current: boolean, selected: boolean): string {
  const classNames = ["world-system"];

  if (current) {
    classNames.push("world-system-current");
  }

  if (selected) {
    classNames.push("world-system-selected");
  }

  return classNames.join(" ");
}

function getWorldSystemGlowRadius(current: boolean): number {
  if (current) {
    return 3.3;
  }

  return 2.15;
}

function getWorldSystemCoreRadius(current: boolean): number {
  if (current) {
    return 0.95;
  }

  return 0.64;
}

function SystemBattlePanel({
  system,
  battles,
  activeBattleId,
  loading,
  notice,
  onStartBattle,
  onOpenBattle
}: SystemBattlePanelProps) {
  return (
    <section className="system-battle-panel">
      <div className="system-battle-header">
        <div>
          <h2>{getSelectedSystemName(system)}</h2>
          <p>{getSelectedSystemDescription(system)}</p>
        </div>
        <button type="button" disabled={Boolean(activeBattleId)} onClick={onStartBattle}>
          Начать бой
        </button>
      </div>
      {notice ? <p className="system-battle-notice">{notice}</p> : null}
      <div className="battle-list-header">
        <span>Бои в системе</span>
        <strong>{getBattleListCountText(loading, battles.length)}</strong>
      </div>
      <div className="battle-list">
        {battles.length === 0 ? <p className="battle-list-empty">В этой системе пока нет боев.</p> : null}
        {battles.map((battle) => (
          <button
            key={battle.id}
            type="button"
            className={getBattleButtonClassName(battle.id, activeBattleId)}
            onClick={() => onOpenBattle(battle.id)}
          >
            <span>{battle.name}</span>
            <strong>{getBattleMetaText(battle)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function getSelectedSystemName(system: StarSystem | undefined): string {
  if (!system) {
    return "Система не выбрана";
  }

  return system.name;
}

function getSelectedSystemDescription(system: StarSystem | undefined): string {
  if (!system) {
    return "Выберите систему на звездной карте";
  }

  return `${system.region}; security ${system.security.toFixed(1)}`;
}

function getBattleListCountText(loading: boolean, count: number): string {
  if (loading) {
    return "loading";
  }

  return `${count}`;
}

function getBattleButtonClassName(battleId: string, activeBattleId: string | null): string {
  if (battleId === activeBattleId) {
    return "battle-list-item battle-list-item-active";
  }

  return "battle-list-item";
}

function getBattleMetaText(battle: BattleSummary): string {
  return `turn ${battle.turn}; ${battle.phase}; pilots ${battle.playerCount}`;
}

function getBattleResultTitle(state: CombatState): string {
  if (state.winner) {
    return `Победила сторона ${state.winner}`;
  }

  return "Бой завершен";
}

function getBattleResultTurnText(state: CombatState): string {
  return `turn ${state.turn}`;
}

function getCombatDamageEvents(state: CombatState): CombatDamageEvent[] {
  if (!state.damageEvents) {
    return [];
  }

  return state.damageEvents;
}

function createPlayerDamageRows(events: CombatDamageEvent[]): DamageTargetRow[] {
  const damageByTarget = new Map<string, DamageTargetRow>();

  for (const event of events) {
    if (event.attackerSide !== "A") {
      continue;
    }

    const current = damageByTarget.get(event.targetShipId);

    if (current) {
      damageByTarget.set(event.targetShipId, {
        ...current,
        damage: current.damage + event.damage
      });
      continue;
    }

    damageByTarget.set(event.targetShipId, {
      targetShipId: event.targetShipId,
      targetName: event.targetName,
      damage: event.damage
    });
  }

  return [...damageByTarget.values()].sort(sortDamageTargetRows);
}

function createDamageTotalRows(events: CombatDamageEvent[]): DamageTotalRow[] {
  const damageByAttacker = new Map<string, DamageTotalRow>();

  for (const event of events) {
    const current = damageByAttacker.get(event.attackerShipId);

    if (current) {
      damageByAttacker.set(event.attackerShipId, {
        ...current,
        damage: current.damage + event.damage
      });
      continue;
    }

    damageByAttacker.set(event.attackerShipId, {
      attackerShipId: event.attackerShipId,
      attackerName: event.attackerName,
      attackerSide: event.attackerSide,
      damage: event.damage
    });
  }

  return [...damageByAttacker.values()].sort(sortDamageTotalRows);
}

function sortDamageTargetRows(left: DamageTargetRow, right: DamageTargetRow): number {
  return right.damage - left.damage || left.targetName.localeCompare(right.targetName);
}

function sortDamageTotalRows(left: DamageTotalRow, right: DamageTotalRow): number {
  return right.damage - left.damage || left.attackerName.localeCompare(right.attackerName);
}

function getPilotListCountText(loading: boolean, count: number): string {
  if (loading) {
    return "loading";
  }

  return `${count}`;
}

function getPilotStatusText(pilot: SystemPilot): string {
  if (pilot.activeBattleId) {
    return "в бою";
  }

  return "в системе";
}

function getPilotCardClassName(pilot: SystemPilot): string {
  if (pilot.activeBattleId) {
    return "pilot-list-item pilot-list-item-busy";
  }

  return "pilot-list-item";
}

function getPilotInitial(pilot: SystemPilot): string {
  return pilot.nickname.slice(0, 1).toLocaleUpperCase("ru-RU");
}

function getPilotAction(
  currentUserId: string | undefined,
  activeBattleId: string | null,
  pilot: SystemPilot
): PilotAction {
  if (pilot.id === currentUserId) {
    return {
      text: "Вы",
      disabled: true,
      className: "pilot-action pilot-action-self"
    };
  }

  if (activeBattleId) {
    return {
      text: "Недоступно",
      disabled: true,
      className: "pilot-action"
    };
  }

  if (pilot.activeBattleId) {
    return {
      text: "В бою",
      disabled: true,
      className: "pilot-action"
    };
  }

  return {
    text: "Атаковать",
    disabled: false,
    className: "pilot-action pilot-action-attack"
  };
}

function clearPilotBattle(pilot: SystemPilot): SystemPilot {
  return {
    id: pilot.id,
    nickname: pilot.nickname,
    systemId: pilot.systemId
  };
}

function markPilotBattle(
  pilots: SystemPilot[],
  pilotId: string | undefined,
  battleId: string
): SystemPilot[] {
  if (!pilotId) {
    return pilots;
  }

  return pilots.map((pilot) => markMatchingPilotBattle(pilot, pilotId, battleId));
}

function markPilotsBattle(
  pilots: SystemPilot[],
  pilotIds: string[],
  battleId: string
): SystemPilot[] {
  return pilots.map((pilot) => markListedPilotBattle(pilot, pilotIds, battleId));
}

function markListedPilotBattle(
  pilot: SystemPilot,
  pilotIds: string[],
  battleId: string
): SystemPilot {
  if (!pilotIds.includes(pilot.id)) {
    return pilot;
  }

  return {
    ...pilot,
    activeBattleId: battleId
  };
}

function markMatchingPilotBattle(
  pilot: SystemPilot,
  pilotId: string,
  battleId: string
): SystemPilot {
  if (pilot.id !== pilotId) {
    return pilot;
  }

  return {
    ...pilot,
    activeBattleId: battleId
  };
}

function SystemPilotPanel({
  currentUserId,
  activeBattleId,
  pilots,
  loading,
  onAttackPilot
}: SystemPilotPanelProps) {
  return (
    <section className="system-pilot-panel">
      <div className="system-panel-header">
        <h2>Пилоты</h2>
        <strong>{getPilotListCountText(loading, pilots.length)}</strong>
      </div>
      <div className="pilot-list">
        {pilots.length === 0 ? <p className="pilot-list-empty">В системе нет пилотов.</p> : null}
        {pilots.map((pilot) => (
          <SystemPilotCard
            key={pilot.id}
            currentUserId={currentUserId}
            activeBattleId={activeBattleId}
            pilot={pilot}
            onAttackPilot={onAttackPilot}
          />
        ))}
      </div>
    </section>
  );
}

function SystemPilotCard({
  currentUserId,
  activeBattleId,
  pilot,
  onAttackPilot
}: SystemPilotCardProps) {
  const action = getPilotAction(currentUserId, activeBattleId, pilot);

  return (
    <article className={getPilotCardClassName(pilot)}>
      <span className="pilot-avatar">{getPilotInitial(pilot)}</span>
      <div>
        <strong>{pilot.nickname}</strong>
        <span>{getPilotStatusText(pilot)}</span>
      </div>
      <button
        type="button"
        className={action.className}
        disabled={action.disabled}
        onClick={() => onAttackPilot(pilot.id)}
      >
        {action.text}
      </button>
    </article>
  );
}

function RegistrationScreen({ onRegistered }: RegistrationScreenProps) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitRegistration(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);

    if (password !== passwordConfirm) {
      setMessage("Пароли не совпадают.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(registerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          nickname,
          password,
          passwordConfirm
        })
      });
      const result = (await response.json()) as RegisterResponse;

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      onRegistered(result.user);
    } catch {
      setMessage("Не удалось подключиться к серверу регистрации.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submitRegistration}>
        <div>
          <h1>Hex Space Game</h1>
          <p>Создание пилота</p>
        </div>
        <label>
          <span>Ник</span>
          <input
            value={nickname}
            minLength={3}
            maxLength={24}
            autoComplete="username"
            required
            onChange={(event) => setNickname(event.target.value)}
          />
        </label>
        <label>
          <span>Пароль</span>
          <input
            value={password}
            type="password"
            minLength={6}
            autoComplete="new-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>Повтор пароля</span>
          <input
            value={passwordConfirm}
            type="password"
            minLength={6}
            autoComplete="new-password"
            required
            onChange={(event) => setPasswordConfirm(event.target.value)}
          />
        </label>
        {message ? <p className="auth-message">{message}</p> : null}
        <button type="submit" disabled={submitting}>
          {getRegisterButtonText(submitting)}
        </button>
      </form>
    </main>
  );
}

function ShipRoster({ side, ships }: ShipRosterProps) {
  return (
    <div className={getShipRosterClassName(side)} aria-label={getShipRosterLabel(side)}>
      {ships.map((ship) => (
        <ShipAvatar
          key={ship.id}
          ship={ship}
        />
      ))}
    </div>
  );
}

function ShipAvatar({ ship }: ShipAvatarProps) {
  const healthCells = Array.from({ length: ship.maxHp }, (_, index) => index);
  const shipStyle = {
    "--ship-color": SHIP_COLOR_BY_SIDE[ship.side]
  } as CSSProperties;
  const healthStyle = {
    gridTemplateColumns: `repeat(${ship.maxHp}, minmax(0, 1fr))`
  };

  return (
    <article
      className={getShipCardClassName(ship)}
      style={shipStyle}
      aria-label={`${ship.name}: ${ship.hp}/${ship.maxHp} HP`}
    >
      <div className="ship-avatar">
        <span className="ship-avatar-mark" />
        <span className="ship-avatar-glow" />
        <span className="ship-side-badge">{ship.side}</span>
      </div>
      <div className="ship-health-bar" style={healthStyle}>
        {healthCells.map((index) => (
          <span key={index} className={getHealthCellClassName(index, ship.hp)} />
        ))}
      </div>
      <div className="ship-tooltip" role="tooltip">
        {ship.name}: {ship.hp}/{ship.maxHp} HP
      </div>
    </article>
  );
}

function ActionModules({
  ship,
  activeTool,
  inputLocked,
  plannedShotCounts,
  onMoveSelect,
  onWeaponSelect,
  onWeaponHover,
  onWeaponLeave
}: ActionModulesProps) {
  if (!ship) {
    return <div className="action-modules action-modules-empty" />;
  }

  return (
    <div className="action-modules" aria-label="Available ship modules">
      <button
        type="button"
        className={getMoveModuleButtonClassName(activeTool)}
        disabled={inputLocked}
        onMouseEnter={onWeaponLeave}
        onFocus={onWeaponLeave}
        onClick={onMoveSelect}
      >
        <span className="module-letter" aria-hidden="true">M</span>
        <span className="module-name">Move</span>
        <strong className="module-count">{ship.speed}</strong>
      </button>
      {ship.weapons.map((weapon) => (
        <WeaponModuleButton
          key={weapon.id}
          weapon={weapon}
          activeTool={activeTool}
          inputLocked={inputLocked}
          plannedShotCount={plannedShotCounts.get(weapon.id) ?? 0}
          onWeaponSelect={onWeaponSelect}
          onWeaponHover={onWeaponHover}
          onWeaponLeave={onWeaponLeave}
        />
      ))}
    </div>
  );
}

function WeaponModuleButton({
  weapon,
  activeTool,
  inputLocked,
  plannedShotCount,
  onWeaponSelect,
  onWeaponHover,
  onWeaponLeave
}: {
  weapon: ShipWeapon;
  activeTool: CombatInputTool;
  inputLocked: boolean;
  plannedShotCount: number;
  onWeaponSelect(weaponId: string): void;
  onWeaponHover(weaponId: string): void;
  onWeaponLeave(): void;
}) {
  const remainingShots = Math.max(0, weapon.shots - plannedShotCount);
  const moduleStyle = {
    "--module-color": toCssColor(weapon.color)
  } as CSSProperties;

  return (
    <button
      type="button"
      className={getWeaponModuleButtonClassName(activeTool, weapon.id, remainingShots)}
      disabled={inputLocked}
      style={moduleStyle}
      aria-label={`${weapon.name}: ${remainingShots}/${weapon.shots} shots left`}
      onMouseEnter={() => onWeaponHover(weapon.id)}
      onMouseLeave={onWeaponLeave}
      onFocus={() => onWeaponHover(weapon.id)}
      onBlur={onWeaponLeave}
      onClick={() => onWeaponSelect(weapon.id)}
    >
      <span className="module-letter" aria-hidden="true">{weapon.name[0]}</span>
      <span className="module-name">{weapon.name}</span>
      <strong className="module-count">
        {remainingShots}/{weapon.shots}
      </strong>
    </button>
  );
}

function getShipsBySide(state: CombatState, side: ShipSide): ShipState[] {
  return state.ships.filter((ship) => ship.side === side);
}

function resolveAppPage(activeBattleId: string | null): AppPage {
  if (activeBattleId) {
    return "combat";
  }

  return "world";
}

function getAppShellClassName(page: AppPage): string {
  if (page === "combat") {
    return "app-shell app-shell-combat";
  }

  return "app-shell app-shell-world";
}

function getPilotName(authUser: AuthUser | null): string {
  if (!authUser) {
    return "Unknown pilot";
  }

  return authUser.nickname;
}

function getActiveBattleText(activeBattleId: string | null): string {
  if (activeBattleId) {
    return "Активный бой открыт";
  }

  return "Нет активного боя";
}

function getSubmitButtonText(inputLocked: boolean): string {
  if (inputLocked) {
    return "Ожидание";
  }

  return "Отправить ход";
}

function readStoredAuthUser(): AuthUser | null {
  try {
    const storedValue = localStorage.getItem(authStorageKey);

    if (!storedValue) {
      return null;
    }

    const user = JSON.parse(storedValue) as AuthUser;

    if (isAuthUser(user)) {
      return user;
    }
  } catch {
    return null;
  }

  return null;
}

function createCombatWebsocketUrl(battleId: string): string {
  return `${websocketUrl}/${battleId}`;
}

function createDefaultApiBaseUrl(): string {
  if (isLocalBrowserHost()) {
    return "http://127.0.0.1:3001";
  }

  return window.location.origin;
}

function createDefaultWebsocketUrl(): string {
  if (isLocalBrowserHost()) {
    return "ws://127.0.0.1:3001/ws/combat";
  }

  const protocol = getBrowserWebsocketProtocol();
  return `${protocol}//${window.location.host}/ws/combat`;
}

function isLocalBrowserHost(): boolean {
  const host = window.location.hostname;

  if (host === "localhost") {
    return true;
  }

  if (host === "127.0.0.1") {
    return true;
  }

  return host === "";
}

function getBrowserWebsocketProtocol(): string {
  if (window.location.protocol === "https:") {
    return "wss:";
  }

  return "ws:";
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const user = value as AuthUser;

  return (
    typeof user.id === "string" &&
    typeof user.nickname === "string" &&
    typeof user.createdAt === "number"
  );
}

function getRegisterButtonText(submitting: boolean): string {
  if (submitting) {
    return "Создание...";
  }

  return "Создать пилота";
}

function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function getShipRosterClassName(side: ShipRosterSide): string {
  if (side === "ally") {
    return "ship-roster ship-roster-ally";
  }

  return "ship-roster ship-roster-enemy";
}

function getShipRosterLabel(side: ShipRosterSide): string {
  if (side === "ally") {
    return "Allied ships";
  }

  return "Enemy ships";
}

function getShipCardClassName(ship: ShipState): string {
  const classNames = ["ship-card", getShipSideClassName(ship.side)];

  if (ship.hp <= 0) {
    classNames.push("ship-card-destroyed");
  }

  if (ship.escaped) {
    classNames.push("ship-card-escaped");
  }

  return classNames.join(" ");
}

function getShipSideClassName(side: ShipSide): string {
  if (side === "A") {
    return "ally";
  }

  return "enemy";
}

function getHealthCellClassName(index: number, hp: number): string {
  if (index < hp) {
    return "health-cell health-cell-filled";
  }

  return "health-cell";
}

function getPreviewWeaponId(inputLocked: boolean, hoveredWeaponId: string | null): string | null {
  if (inputLocked) {
    return null;
  }

  return hoveredWeaponId;
}

function getPhaseText(state: CombatState, pendingOrder: PendingOrder | null): string {
  if (state.winner) {
    return `Победила сторона ${state.winner}`;
  }

  if (state.phase === "resolving" || pendingOrder) {
    return "расчет хода...";
  }

  return "планирование хода";
}

function getMoveModuleButtonClassName(activeTool: CombatInputTool): string {
  const classNames = ["ship-module-button", "move-module"];

  if (activeTool.type === "move") {
    classNames.push("active-tool");
  }

  return classNames.join(" ");
}

function getCoordinateButtonClassName(showCellCoordinates: boolean): string {
  if (showCellCoordinates) {
    return "tool-button active-tool";
  }

  return "tool-button";
}

function getWeaponModuleButtonClassName(
  activeTool: CombatInputTool,
  weaponId: string,
  remainingShots: number
): string {
  const classNames = ["ship-module-button", "weapon-module"];

  if (activeTool.type === "weapon" && activeTool.weaponId === weaponId) {
    classNames.push("active-tool");
  }

  if (remainingShots <= 0) {
    classNames.push("module-empty");
  }

  return classNames.join(" ");
}
