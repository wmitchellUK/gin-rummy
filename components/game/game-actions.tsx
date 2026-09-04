import type { LegalControl, PublicCard, selectedDiscardActionAvailability } from "@/src/shared/game-view";
import { CardMark, cardLabel } from "./game-card";

type SelectedActions = ReturnType<typeof selectedDiscardActionAvailability>;

export function ContextualGameActions({
  legalControls,
  busy,
  discard,
  selected,
  selectedActions,
  onAction,
}: {
  legalControls: readonly LegalControl[];
  busy: boolean;
  discard?: PublicCard;
  selected?: PublicCard;
  selectedActions: SelectedActions;
  onAction: (type: LegalControl, cardId?: string) => Promise<void> | void;
}) {
  const has = (control: LegalControl) => legalControls.includes(control);
  const controls: React.ReactNode[] = [];
  let alignOnlyActionRight = false;

  if (has("PASS_INITIAL_UPCARD") || has("TAKE_INITIAL_UPCARD")) {
    if (has("PASS_INITIAL_UPCARD")) controls.push(<button key="pass" className="action-button secondary context-action" disabled={busy} onClick={() => void onAction("PASS_INITIAL_UPCARD")}>Pass</button>);
    if (has("TAKE_INITIAL_UPCARD")) controls.push(<button key="take-opening" className="action-button wood context-action" disabled={busy || !discard} onClick={() => void onAction("TAKE_INITIAL_UPCARD")}>Take discard</button>);
  } else if (has("DRAW_STOCK") || has("DRAW_DISCARD")) {
    if (has("DRAW_STOCK")) controls.push(<button key="draw-stock" className="action-button primary context-action" disabled={busy} onClick={() => void onAction("DRAW_STOCK")}>Draw stock</button>);
    if (has("DRAW_DISCARD")) controls.push(<button key="draw-discard" className="action-button wood context-action" disabled={busy || !discard} onClick={() => void onAction("DRAW_DISCARD")}>Take discard</button>);
  } else if (has("DISCARD")) {
    if (!selected) {
      controls.push(<p key="select" className="action-guidance">Select a card to discard</p>);
    } else if (selectedActions.isProhibitedDiscard || !selectedActions.canDiscard) {
      controls.push(<p key="restricted" className="action-guidance">Choose another card</p>);
    } else {
      const label = cardLabel(selected);
      const hasDeclaration = selectedActions.canGin || selectedActions.canKnock;
      alignOnlyActionRight = !hasDeclaration;
      controls.push(<button key="discard" aria-label={`Discard ${label}`} className={`action-button discard context-action${hasDeclaration ? "" : " right-aligned-action"}`} disabled={busy} onClick={() => void onAction("DISCARD", selected.id)}>Discard <CardMark card={selected} /></button>);
      if (selectedActions.canGin) {
        controls.push(<button key="gin" aria-label={`Declare gin by discarding ${label}`} className="action-button gin context-action" disabled={busy} onClick={() => void onAction("GIN", selected.id)}>GIN</button>);
      } else if (selectedActions.canKnock) {
        controls.push(<button key="knock" aria-label={`Knock with ${selectedActions.deadwoodValue} deadwood points after discarding ${label}`} className="action-button knock context-action" disabled={busy} onClick={() => void onAction("KNOCK", selected.id)}>Knock <span>{selectedActions.deadwoodValue} pts</span></button>);
      }
    }
  }

  if (controls.length === 0) return null;
  return <section className={`game-actions${controls.length === 1 && !alignOnlyActionRight ? " single-action" : ""}`} aria-label="Game actions" aria-busy={busy}>{controls}</section>;
}
