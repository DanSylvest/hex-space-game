import type { CombatOrder, CombatState } from "./combat";

export type ClientMessage =
  | {
      type: "combat.submitOrder";
      order: CombatOrder;
    }
  | {
      type: "combat.reset";
    };

export type ServerMessage =
  | {
      type: "combat.snapshot";
      state: CombatState;
    }
  | {
      type: "combat.ended";
      battleId: string;
      state: CombatState;
      message: string;
    }
  | {
      type: "combat.orderAccepted";
      turn: number;
      order: CombatOrder;
    }
  | {
      type: "combat.error";
      message: string;
    };
