import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedDiscardActionAvailability, type LegalControl, type PlayerGameView, type PublicCard } from "@/src/shared/game-view";
import { ContextualGameActions } from "./game-actions";

const discard: PublicCard = { id: "4:SPADES", rank: "4", suit: "SPADES" };
const selected: PublicCard = { id: "9:CLUBS", rank: "9", suit: "CLUBS" };

function renderActions(
  legalControls: readonly LegalControl[],
  options: {
    selected?: PublicCard;
    declaration?: "KNOCK" | "GIN" | null;
    deadwoodValue?: number;
    prohibited?: boolean;
    busy?: boolean;
  } = {},
) {
  const selectedCard = options.selected;
  const game: Pick<PlayerGameView, "legalControls" | "turnRestrictions" | "discardOutcomes"> = {
    legalControls,
    ...(options.prohibited && selectedCard ? { turnRestrictions: { cannotDiscardCardId: selectedCard.id } } : {}),
    discardOutcomes: selectedCard && !options.prohibited ? [{
      cardId: selectedCard.id,
      deadwoodValue: options.deadwoodValue ?? 18,
      declaration: options.declaration ?? null,
    }] : [],
  };
  const onAction = vi.fn();
  render(<ContextualGameActions
    legalControls={legalControls}
    busy={options.busy ?? false}
    discard={discard}
    selected={selectedCard}
    selectedActions={selectedDiscardActionAvailability(game, selectedCard?.id)}
    onAction={onAction}
  />);
  return onAction;
}

afterEach(cleanup);

describe("ContextualGameActions", () => {
  it("shows only the two opening actions", () => {
    renderActions(["PASS_INITIAL_UPCARD", "TAKE_INITIAL_UPCARD"]);
    expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Take discard" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Draw stock/ })).not.toBeInTheDocument();
  });

  it("shows only legal draw sources", () => {
    renderActions(["DRAW_STOCK"]);
    expect(screen.getByRole("button", { name: "Draw stock" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Take discard" })).not.toBeInTheDocument();
  });

  it("prompts for selection without rendering inactive declaration controls", () => {
    renderActions(["DISCARD", "KNOCK", "GIN"]);
    expect(screen.getByText("Select a card to discard")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("submits an ordinary selected discard", async () => {
    const onAction = renderActions(["DISCARD", "KNOCK", "GIN"], { selected });
    const discardButton = screen.getByRole("button", { name: "Discard 9 of clubs" });
    expect(discardButton).toHaveClass("right-aligned-action");
    expect(discardButton.parentElement).not.toHaveClass("single-action");
    await userEvent.setup().click(discardButton);
    expect(onAction).toHaveBeenCalledWith("DISCARD", selected.id);
    expect(screen.queryByRole("button", { name: /Knock/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gin/i })).not.toBeInTheDocument();
  });

  it("pairs discard with a legal knock and its deadwood value", async () => {
    const onAction = renderActions(["DISCARD", "KNOCK", "GIN"], { selected, declaration: "KNOCK", deadwoodValue: 7 });
    const knock = screen.getByRole("button", { name: "Knock with 7 deadwood points after discarding 9 of clubs" });
    expect(knock).toHaveTextContent("Knock 7 pts");
    await userEvent.setup().click(knock);
    expect(onAction).toHaveBeenCalledWith("KNOCK", selected.id);
  });

  it("pairs discard with gin instead of knock", async () => {
    const onAction = renderActions(["DISCARD", "KNOCK", "GIN"], { selected, declaration: "GIN", deadwoodValue: 0 });
    const gin = screen.getByRole("button", { name: "Declare gin by discarding 9 of clubs" });
    expect(screen.queryByRole("button", { name: /Knock/ })).not.toBeInTheDocument();
    await userEvent.setup().click(gin);
    expect(onAction).toHaveBeenCalledWith("GIN", selected.id);
  });

  it("explains a prohibited selection and preserves controls while busy", () => {
    const { rerender } = render(<ContextualGameActions
      legalControls={["DISCARD", "KNOCK", "GIN"]}
      busy={false}
      discard={discard}
      selected={selected}
      selectedActions={selectedDiscardActionAvailability({ legalControls: ["DISCARD", "KNOCK", "GIN"], turnRestrictions: { cannotDiscardCardId: selected.id }, discardOutcomes: [] }, selected.id)}
      onAction={vi.fn()}
    />);
    expect(screen.getByText("Choose another card")).toBeInTheDocument();

    rerender(<ContextualGameActions
      legalControls={["DRAW_STOCK", "DRAW_DISCARD"]}
      busy
      discard={discard}
      selectedActions={selectedDiscardActionAvailability({ legalControls: ["DRAW_STOCK", "DRAW_DISCARD"] })}
      onAction={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Draw stock" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take discard" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Game actions" })).toHaveAttribute("aria-busy", "true");
  });
});
