import websocket from "@fastify/websocket";
import {
  type AuthUser,
  type ActiveBattleResponse,
  type BattleSummary,
  type BattlesResponse,
  type ClientMessage,
  type CombatWeaponShot,
  type RegisterRequest,
  type RegisterResponse,
  type ServerMessage,
  type StartBattleRequest,
  type StartBattleResponse,
  type SystemPilot,
  type SystemPilotsResponse,
  type WorldPresenceRequest,
  type WorldPresenceResponse,
  STAR_SYSTEMS,
  PLAYER_START_SYSTEM_ID,
  createInitialCombatState,
  createResolvingCombatState,
  resolveCombatTurn,
  validateCombatOrder
} from "@hex-space/shared";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import Fastify from "fastify";

type CombatSocket = {
  send(data: string): void;
  on(event: "message", handler: (data: Buffer | string) => void): void;
  on(event: "close", handler: () => void): void;
};
type UserRecord = AuthUser & {
  nicknameKey: string;
  passwordHash: string;
  passwordSalt: string;
};
type CombatRuntime = {
  state: ReturnType<typeof createInitialCombatState>;
  systemId: string;
  createdAt: number;
  playerIds: Set<string>;
  sockets: Set<CombatSocket>;
  pendingResolve?: ReturnType<typeof setTimeout>;
};

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const resolveDelayMs = Number(process.env.COMBAT_RESOLVE_DELAY_MS ?? 550);
const onlinePresenceTtlMs = Number(process.env.ONLINE_PRESENCE_TTL_MS ?? 45_000);
const scrypt = promisify(scryptCallback);
const usersFilePath = path.resolve("data", "users.json");

const fastify = Fastify({
  logger: true
});

const battles = new Map<string, CombatRuntime>();
const activeBattleByUserId = new Map<string, string>();
const onlinePresenceByUserId = new Map<string, number>();

await fastify.register(websocket);

fastify.addHook("onRequest", async (_request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
});

fastify.options("/*", async () => ({}));

fastify.get("/health", async () => ({
  ok: true,
  battles: battles.size,
  activePlayers: activeBattleByUserId.size,
  onlinePlayers: countOnlinePlayers()
}));

fastify.post<{ Body: RegisterRequest; Reply: RegisterResponse }>("/auth/register", async (request, reply) => {
  const payload = parseRegisterRequest(request.body);

  if (!payload) {
    reply.code(400);
    return {
      ok: false,
      message: "Введите ник, пароль и повтор пароля."
    };
  }

  const validationMessage = validateRegisterRequest(payload);

  if (validationMessage) {
    reply.code(400);
    return {
      ok: false,
      message: validationMessage
    };
  }

  const users = await readUsers();
  const nickname = payload.nickname.trim();
  const nicknameKey = createNicknameKey(nickname);
  const existingUser = users.find((user) => user.nicknameKey === nicknameKey);

  if (existingUser) {
    reply.code(409);
    return {
      ok: false,
      message: "Такой ник уже занят."
    };
  }

  const user = await createUserRecord(nickname, payload.password);
  await writeUsers([...users, user]);

  return {
    ok: true,
    user: toAuthUser(user)
  };
});

fastify.get<{
  Params: { systemId: string };
  Querystring: { userId?: string };
  Reply: BattlesResponse;
}>("/world/systems/:systemId/battles", async (request) => {
  const battlesInSystem = [...battles.values()]
    .filter((battle) => battle.systemId === request.params.systemId)
    .map(toBattleSummary);
  const activeBattleId = getActiveBattleIdForUser(request.query.userId);

  return {
    battles: battlesInSystem,
    activeBattleId
  };
});

fastify.get<{
  Params: { systemId: string };
  Reply: SystemPilotsResponse;
}>("/world/systems/:systemId/pilots", async (request) => {
  const users = await readUsers();
  pruneOfflinePresence();

  return {
    pilots: users
      .filter((user) => isUserOnline(user.id))
      .map((user) => toSystemPilot(user))
      .filter((pilot) => pilot.systemId === request.params.systemId)
  };
});

fastify.post<{
  Body: WorldPresenceRequest;
  Reply: WorldPresenceResponse;
}>("/world/presence", async (request, reply) => {
  const userId = request.body?.userId;

  if (typeof userId !== "string" || userId.length === 0) {
    reply.code(400);
    return {
      ok: false,
      message: "User id is required."
    };
  }

  const user = await findUserById(userId);

  if (!user) {
    reply.code(404);
    return {
      ok: false,
      message: "User does not exist."
    };
  }

  const onlineUntil = markUserOnline(user.id);

  return {
    ok: true,
    onlineUntil
  };
});

fastify.post<{
  Params: { systemId: string };
  Body: StartBattleRequest;
  Reply: StartBattleResponse;
}>("/world/systems/:systemId/battles", async (request, reply) => {
  const system = STAR_SYSTEMS.find((item) => item.id === request.params.systemId);

  if (!system) {
    reply.code(404);
    return {
      ok: false,
      message: "Star system does not exist."
    };
  }

  const userId = request.body?.userId;

  if (typeof userId !== "string" || userId.length === 0) {
    reply.code(400);
    return {
      ok: false,
      message: "User id is required."
    };
  }

  const targetUserId = parseTargetUserId(request.body?.targetUserId);
  const users = await readUsers();
  const user = findTargetUser(users, userId);
  const targetUser = findTargetUser(users, targetUserId);
  const existingBattleId = getActiveBattleIdForUser(userId);

  if (!user) {
    reply.code(404);
    return {
      ok: false,
      message: "User does not exist."
    };
  }

  markUserOnline(user.id);

  if (existingBattleId) {
    reply.code(409);
    return {
      ok: false,
      message: "Player is already in battle.",
      activeBattleId: existingBattleId
    };
  }

  if (targetUserId === userId) {
    reply.code(400);
    return {
      ok: false,
      message: "Cannot attack yourself."
    };
  }

  if (targetUserId && !targetUser) {
    reply.code(404);
    return {
      ok: false,
      message: "Target pilot does not exist."
    };
  }

  if (targetUserId && !isUserOnline(targetUserId)) {
    reply.code(409);
    return {
      ok: false,
      message: "Target pilot is offline."
    };
  }

  const targetBattleId = getActiveBattleIdForUser(targetUserId);

  if (targetBattleId) {
    reply.code(409);
    return {
      ok: false,
      message: "Target pilot is already in battle."
    };
  }

  const playerIds = createBattlePlayerIds(userId, targetUserId);
  const battle = createBattleRuntime(request.params.systemId, playerIds);
  battles.set(battle.state.id, battle);
  setActiveBattleForPlayers(playerIds, battle.state.id);

  return {
    ok: true,
    battle: toBattleSummary(battle),
    activeBattleId: battle.state.id
  };
});

fastify.get<{
  Params: { userId: string };
  Reply: ActiveBattleResponse;
}>("/world/players/:userId/active-battle", async (request) => {
  const battleId = getActiveBattleIdForUser(request.params.userId);

  if (!battleId) {
    return {
      ok: false
    };
  }

  const battle = battles.get(battleId);

  if (!battle) {
    return {
      ok: false
    };
  }

  return {
    ok: true,
    battle: toBattleSummary(battle)
  };
});

fastify.get<{ Params: { battleId: string } }>("/ws/combat/:battleId", { websocket: true }, (socket, request) => {
  const battle = battles.get(request.params.battleId);
  const combatSocket = socket as CombatSocket;

  if (!battle) {
    send(combatSocket, {
      type: "combat.error",
      message: "Battle does not exist."
    });
    combatSocket.on("close", () => undefined);
    return;
  }

  battle.sockets.add(combatSocket);
  send(combatSocket, {
    type: "combat.snapshot",
    state: battle.state
  });

  combatSocket.on("message", (raw) => {
    const message = parseClientMessage(raw);

    if (!message) {
      send(combatSocket, {
        type: "combat.error",
        message: "Invalid client message."
      });
      return;
    }

    if (message.type === "combat.reset") {
      clearPendingResolve(battle);
      battle.state = createInitialCombatState(battle.state.id);
      broadcast(battle, {
        type: "combat.snapshot",
        state: battle.state
      });
      return;
    }

    const validation = validateCombatOrder(battle.state, "A", message.order);

    if (!validation.ok) {
      send(combatSocket, {
        type: "combat.error",
        message: validation.message
      });
      return;
    }

    send(combatSocket, {
      type: "combat.orderAccepted",
      turn: battle.state.turn,
      order: message.order
    });

    battle.state = createResolvingCombatState(battle.state);
    broadcast(battle, {
      type: "combat.snapshot",
      state: battle.state
    });

    battle.pendingResolve = setTimeout(() => {
      battle.pendingResolve = undefined;
      battle.state = resolveCombatTurn(battle.state, [message.order]);

      if (battle.state.phase === "complete") {
        endBattle(battle, "Бой завершен. Возврат на карту.");
        return;
      }

      broadcast(battle, {
        type: "combat.snapshot",
        state: battle.state
      });
    }, resolveDelayMs);
  });

  combatSocket.on("close", () => {
    battle.sockets.delete(combatSocket);
  });
});

try {
  await fastify.listen({ port, host });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}

function broadcast(battle: CombatRuntime, message: ServerMessage): void {
  for (const socket of battle.sockets) {
    send(socket, message);
  }
}

function send(socket: CombatSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function clearPendingResolve(battle: CombatRuntime): void {
  if (!battle.pendingResolve) {
    return;
  }

  clearTimeout(battle.pendingResolve);
  battle.pendingResolve = undefined;
}

function createBattleRuntime(systemId: string, playerIds: string[]): CombatRuntime {
  const battleNumber = battles.size + 1;
  const battleId = `battle-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const state = createInitialCombatState(battleId);

  return {
    state: {
      ...state,
      log: [
        {
          turn: state.turn,
          text: `Battle ${battleNumber} started in ${systemId}.`
        },
        ...state.log
      ]
    },
    systemId,
    createdAt: Date.now(),
    playerIds: new Set(playerIds),
    sockets: new Set()
  };
}

function createBattlePlayerIds(userId: string, targetUserId: string | undefined): string[] {
  if (targetUserId) {
    return [userId, targetUserId];
  }

  return [userId];
}

function setActiveBattleForPlayers(playerIds: string[], battleId: string): void {
  for (const playerId of playerIds) {
    activeBattleByUserId.set(playerId, battleId);
  }
}

function toBattleSummary(battle: CombatRuntime): BattleSummary {
  return {
    id: battle.state.id,
    systemId: battle.systemId,
    name: createBattleName(battle),
    phase: battle.state.phase,
    turn: battle.state.turn,
    playerCount: battle.playerIds.size,
    createdAt: battle.createdAt,
    updatedAt: battle.state.updatedAt
  };
}

function createBattleName(battle: CombatRuntime): string {
  const system = STAR_SYSTEMS.find((item) => item.id === battle.systemId);

  if (system) {
    return `${system.name} skirmish`;
  }

  return "Unknown skirmish";
}

function parseTargetUserId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}

function findTargetUser(users: UserRecord[], targetUserId: string | undefined): UserRecord | undefined {
  if (!targetUserId) {
    return undefined;
  }

  return users.find((user) => user.id === targetUserId);
}

function getActiveBattleIdForUser(userId: string | undefined): string | undefined {
  if (!userId) {
    return undefined;
  }

  const battleId = activeBattleByUserId.get(userId);

  if (!battleId) {
    return undefined;
  }

  const battle = battles.get(battleId);

  if (!battle || battle.state.phase === "complete") {
    activeBattleByUserId.delete(userId);
    return undefined;
  }

  return battleId;
}

function clearCompletedBattlePlayers(battle: CombatRuntime): void {
  if (battle.state.phase !== "complete") {
    return;
  }

  clearActiveBattlePlayers(battle);
}

function clearActiveBattlePlayers(battle: CombatRuntime): void {
  for (const playerId of battle.playerIds) {
    const battleId = activeBattleByUserId.get(playerId);

    if (battleId === battle.state.id) {
      activeBattleByUserId.delete(playerId);
    }
  }
}

function endBattle(battle: CombatRuntime, message: string): void {
  clearPendingResolve(battle);
  clearCompletedBattlePlayers(battle);
  battles.delete(battle.state.id);
  broadcast(battle, {
    type: "combat.ended",
    battleId: battle.state.id,
    state: battle.state,
    message
  });
}

function parseClientMessage(raw: Buffer | string): ClientMessage | undefined {
  try {
    const value = JSON.parse(raw.toString()) as ClientMessage;

    if (value.type === "combat.reset") {
      return value;
    }

    if (
      value.type === "combat.submitOrder" &&
      value.order &&
      typeof value.order.shipId === "string" &&
      Number.isInteger(value.order.moveTo?.col) &&
      Number.isInteger(value.order.moveTo?.row) &&
      isValidShotList(value.order.shots)
    ) {
      return {
        type: "combat.submitOrder",
        order: {
          shipId: value.order.shipId,
          moveTo: value.order.moveTo,
          shots: value.order.shots
        }
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseRegisterRequest(value: unknown): RegisterRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const payload = value as RegisterRequest;

  if (
    typeof payload.nickname !== "string" ||
    typeof payload.password !== "string" ||
    typeof payload.passwordConfirm !== "string"
  ) {
    return undefined;
  }

  return payload;
}

function validateRegisterRequest(payload: RegisterRequest): string | undefined {
  const nickname = payload.nickname.trim();

  if (nickname.length < 3) {
    return "Ник должен быть не короче 3 символов.";
  }

  if (nickname.length > 24) {
    return "Ник должен быть не длиннее 24 символов.";
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(nickname)) {
    return "Ник может содержать только буквы, цифры, _ и -.";
  }

  if (payload.password.length < 6) {
    return "Пароль должен быть не короче 6 символов.";
  }

  if (payload.password !== payload.passwordConfirm) {
    return "Пароли не совпадают.";
  }

  return undefined;
}

async function readUsers(): Promise<UserRecord[]> {
  try {
    const content = await readFile(usersFilePath, "utf8");
    const parsed = JSON.parse(content) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter(isUserRecord);
    }
  } catch {
    return [];
  }

  return [];
}

async function findUserById(userId: string): Promise<UserRecord | undefined> {
  const users = await readUsers();
  return users.find((user) => user.id === userId);
}

async function writeUsers(users: UserRecord[]): Promise<void> {
  await mkdir(path.dirname(usersFilePath), { recursive: true });
  await writeFile(usersFilePath, JSON.stringify(users, null, 2), "utf8");
}

async function createUserRecord(nickname: string, password: string): Promise<UserRecord> {
  const passwordSalt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, passwordSalt, 64)) as Buffer;

  return {
    id: randomBytes(16).toString("hex"),
    nickname,
    nicknameKey: createNicknameKey(nickname),
    passwordHash: hash.toString("hex"),
    passwordSalt,
    createdAt: Date.now()
  };
}

function createNicknameKey(nickname: string): string {
  return nickname.trim().toLocaleLowerCase("en-US");
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    nickname: user.nickname,
    createdAt: user.createdAt
  };
}

function markUserOnline(userId: string): number {
  const onlineUntil = Date.now() + onlinePresenceTtlMs;
  onlinePresenceByUserId.set(userId, onlineUntil);
  return onlineUntil;
}

function isUserOnline(userId: string): boolean {
  const onlineUntil = onlinePresenceByUserId.get(userId);

  if (!onlineUntil) {
    return false;
  }

  if (onlineUntil <= Date.now()) {
    onlinePresenceByUserId.delete(userId);
    return false;
  }

  return true;
}

function pruneOfflinePresence(): void {
  for (const [userId, onlineUntil] of onlinePresenceByUserId) {
    if (onlineUntil <= Date.now()) {
      onlinePresenceByUserId.delete(userId);
    }
  }
}

function countOnlinePlayers(): number {
  pruneOfflinePresence();
  return onlinePresenceByUserId.size;
}

function toSystemPilot(user: UserRecord): SystemPilot {
  const activeBattleId = getActiveBattleIdForUser(user.id);

  if (activeBattleId) {
    return {
      id: user.id,
      nickname: user.nickname,
      systemId: PLAYER_START_SYSTEM_ID,
      activeBattleId
    };
  }

  return {
    id: user.id,
    nickname: user.nickname,
    systemId: PLAYER_START_SYSTEM_ID
  };
}

function isUserRecord(value: unknown): value is UserRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as UserRecord;

  return (
    typeof record.id === "string" &&
    typeof record.nickname === "string" &&
    typeof record.nicknameKey === "string" &&
    typeof record.passwordHash === "string" &&
    typeof record.passwordSalt === "string" &&
    typeof record.createdAt === "number"
  );
}

function isValidShotList(value: unknown): value is CombatWeaponShot[] {
  return (
    Array.isArray(value) &&
    value.every(
      (shot) =>
        shot &&
        typeof shot.weaponId === "string" &&
        Number.isInteger(shot.targetCell?.col) &&
        Number.isInteger(shot.targetCell?.row)
    )
  );
}
