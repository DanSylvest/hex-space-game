export type StarSystem = {
  id: string;
  name: string;
  region: string;
  security: number;
  x: number;
  y: number;
};

export type StarConnection = {
  from: string;
  to: string;
};
export type BattleSummary = {
  id: string;
  systemId: string;
  name: string;
  phase: "planning" | "resolving" | "complete";
  turn: number;
  playerCount: number;
  createdAt: number;
  updatedAt: number;
};
export type SystemPilot = {
  id: string;
  nickname: string;
  systemId: string;
  activeBattleId?: string;
};
export type StartBattleRequest = {
  userId: string;
  targetUserId?: string;
};
export type StartBattleResponse =
  | {
      ok: true;
      battle: BattleSummary;
      activeBattleId: string;
    }
  | {
      ok: false;
      message: string;
      activeBattleId?: string;
    };
export type BattlesResponse = {
  battles: BattleSummary[];
  activeBattleId?: string;
};
export type SystemPilotsResponse = {
  pilots: SystemPilot[];
};
export type WorldPresenceRequest = {
  userId: string;
};
export type WorldPresenceResponse =
  | {
      ok: true;
      onlineUntil: number;
    }
  | {
      ok: false;
      message: string;
    };
export type ActiveBattleResponse =
  | {
      ok: true;
      battle: BattleSummary;
    }
  | {
      ok: false;
    };

export const PLAYER_START_SYSTEM_ID = "jita";

export const STAR_SYSTEMS: StarSystem[] = [
  {
    id: "jita",
    name: "Jita",
    region: "The Forge",
    security: 0.9,
    x: 48,
    y: 29
  },
  {
    id: "perimeter",
    name: "Perimeter",
    region: "The Forge",
    security: 1,
    x: 36,
    y: 23
  },
  {
    id: "new-caldari",
    name: "New Caldari",
    region: "The Forge",
    security: 1,
    x: 28,
    y: 35
  },
  {
    id: "sobaseki",
    name: "Sobaseki",
    region: "Lonetrek",
    security: 0.8,
    x: 17,
    y: 20
  },
  {
    id: "amarr",
    name: "Amarr",
    region: "Domain",
    security: 1,
    x: 75,
    y: 38
  },
  {
    id: "ashab",
    name: "Ashab",
    region: "Domain",
    security: 0.9,
    x: 85,
    y: 51
  },
  {
    id: "dodixie",
    name: "Dodixie",
    region: "Sinq Laison",
    security: 0.9,
    x: 47,
    y: 49
  },
  {
    id: "luminaire",
    name: "Luminaire",
    region: "Essence",
    security: 1,
    x: 32,
    y: 55
  },
  {
    id: "rens",
    name: "Rens",
    region: "Heimatar",
    security: 0.9,
    x: 66,
    y: 16
  },
  {
    id: "hek",
    name: "Hek",
    region: "Metropolis",
    security: 0.5,
    x: 82,
    y: 18
  }
];

export const STAR_CONNECTIONS: StarConnection[] = [
  { from: "sobaseki", to: "perimeter" },
  { from: "perimeter", to: "jita" },
  { from: "perimeter", to: "new-caldari" },
  { from: "new-caldari", to: "luminaire" },
  { from: "jita", to: "dodixie" },
  { from: "dodixie", to: "luminaire" },
  { from: "jita", to: "rens" },
  { from: "rens", to: "hek" },
  { from: "hek", to: "amarr" },
  { from: "amarr", to: "ashab" },
  { from: "dodixie", to: "amarr" }
];
