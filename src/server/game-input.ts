
export type ClientActionType = "PASS_INITIAL_UPCARD" | "TAKE_INITIAL_UPCARD" | "DRAW_STOCK" | "DRAW_DISCARD" | "DISCARD" | "KNOCK" | "GIN" | "START_NEXT_HAND";
export interface ParsedActionRequest { readonly expectedVersion: number; readonly action: { readonly actionId: string; readonly type: ClientActionType; readonly cardId?: string } }

const types = new Set<ClientActionType>(["PASS_INITIAL_UPCARD", "TAKE_INITIAL_UPCARD", "DRAW_STOCK", "DRAW_DISCARD", "DISCARD", "KNOCK", "GIN", "START_NEXT_HAND"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const card = /^(A|[2-9]|10|J|Q|K):(CLUBS|DIAMONDS|HEARTS|SPADES)$/;

export function parseActionRequest(value: unknown): ParsedActionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0 || !body.action || typeof body.action !== "object" || Array.isArray(body.action)) return null;
  const action = body.action as Record<string, unknown>;
  if (typeof action.actionId !== "string" || !uuid.test(action.actionId) || typeof action.type !== "string" || !types.has(action.type as ClientActionType)) return null;
  const needsCard = action.type === "DISCARD" || action.type === "KNOCK" || action.type === "GIN";
  if (needsCard !== (typeof action.cardId === "string")) return null;
  if (typeof action.cardId === "string" && !card.test(action.cardId)) return null;
  if (Object.keys(action).some((key) => !["actionId", "type", "cardId"].includes(key))) return null;
  if (Object.keys(body).some((key) => !["expectedVersion", "action"].includes(key))) return null;
  return { expectedVersion: body.expectedVersion as number, action: { actionId: action.actionId, type: action.type as ClientActionType, ...(typeof action.cardId === "string" ? { cardId: action.cardId } : {}) } };
}
