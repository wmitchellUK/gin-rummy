import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActiveCardArtManifestResponse, FaceCardManifest } from "@/src/shared/card-art";
import type { PublicCard } from "@/src/shared/game-view";
import { CardArtManifestProvider } from "../card-art-provider";
import { CardFace, revisionedCardArtUrl } from "../game-card";

function card(rank: string, suit: string): PublicCard {
  return { id: `${rank}:${suit}`, rank, suit };
}

function renderCard(value: PublicCard, manifest: FaceCardManifest = {}, revision = 0): string {
  const cardArt: ActiveCardArtManifestResponse = {
    source: "CUSTOM",
    setId: "set-1",
    setName: "Test set",
    revision,
    manifest,
  };
  return renderToStaticMarkup(
    <CardArtManifestProvider value={cardArt}><CardFace card={value} /></CardArtManifestProvider>,
  );
}

describe("CardFace", () => {
  it("uses the built-in court design when no portrait exists", () => {
    const markup = renderToStaticMarkup(<CardFace card={card("Q", "HEARTS")} />);

    expect(markup).toContain('class="court-card"');
    expect(markup).not.toContain("court-card-art");
    expect(markup).not.toContain("<img");
  });

  it("falls back by slot when the active manifest is partial", () => {
    const markup = renderCard(card("Q", "HEARTS"), { "J:HEARTS": "https://assets.example/jack.webp" }, 2);

    expect(markup).toContain('class="court-card"');
    expect(markup).not.toContain("court-card-art");
  });

  it.each(["J", "Q", "K"])("replaces the %s center when its portrait slot exists", (rank) => {
    const manifest = { [`${rank}:SPADES`]: `https://assets.example/${rank}.webp` } as FaceCardManifest;
    const markup = renderCard(card(rank, "SPADES"), manifest, 7);

    expect(markup).toContain('class="court-card-art"');
    expect(markup).not.toContain('class="court-card-backdrop"');
    expect(markup).not.toContain('class="court-card-tone"');
    expect(markup).toContain('class="court-card-frame"');
    expect(markup).toContain(`src="https://assets.example/${rank}.webp?v=7"`);
    expect(markup).toContain('class="court-card" hidden=""');
  });

  it("changes the portrait URL when the published revision changes", () => {
    const source = "https://assets.example/queen.webp?v=3";
    const revisionThree = renderCard(card("Q", "CLUBS"), { "Q:CLUBS": source }, 3);
    const revisionFour = renderCard(card("Q", "CLUBS"), { "Q:CLUBS": source }, 4);

    expect(revisionThree).toContain("queen.webp?v=3");
    expect(revisionFour).toContain("queen.webp?v=4");
  });

  it("keeps red and black suit styling with two code-rendered corner indices", () => {
    const red = renderCard(card("K", "DIAMONDS"), { "K:DIAMONDS": "https://assets.example/king.webp" }, 2);
    const black = renderCard(card("J", "CLUBS"), { "J:CLUBS": "https://assets.example/jack.webp" }, 2);

    expect(red).toContain('class="card-face red-suit"');
    expect(black).toContain('class="card-face black-suit"');
    expect(red.match(/class="card-mark red-suit"/g)).toHaveLength(1);
    expect(red.match(/class="card-mark card-mark-inverted"/g)).toHaveLength(1);
    expect(red.match(/<span>K<\/span><span class="suit-icon">♦<\/span>/g)).toHaveLength(2);
  });

  it("leaves number cards and aces on their existing pip layouts", () => {
    const unsupportedManifest = {
      "10:HEARTS": "https://assets.example/ten.webp",
      "A:SPADES": "https://assets.example/ace.webp",
    } as unknown as FaceCardManifest;
    const ten = renderCard(card("10", "HEARTS"), unsupportedManifest, 9);
    const ace = renderCard(card("A", "SPADES"), unsupportedManifest, 9);

    expect(ten).toContain('class="card-pips pip-count-10"');
    expect(ten).not.toContain("<img");
    expect(ace).toContain('class="card-pips pip-count-1"');
    expect(ace).not.toContain("<img");
  });

  it("keeps the card control accessible and falls back when a portrait fails", () => {
    const value = card("Q", "HEARTS");
    const { container } = render(
      <CardArtManifestProvider value={{
        source: "CUSTOM",
        setId: "set-1",
        setName: "Test set",
        revision: 6,
        manifest: { "Q:HEARTS": "https://assets.example/missing.webp" },
      }}>
        <button aria-label="Q of hearts"><CardFace card={value} /></button>
      </CardArtManifestProvider>,
    );
    const portrait = container.querySelector<HTMLImageElement>(".court-card-art img");

    expect(screen.getByRole("button", { name: "Q of hearts" })).toBeVisible();
    expect(portrait).toHaveAttribute("alt", "");
    expect(portrait?.closest(".court-card-art")).not.toHaveAttribute("hidden");

    fireEvent.error(portrait!);
    expect(portrait?.closest(".court-card-art")).toHaveAttribute("hidden");
    expect(container.querySelector(".court-card")).not.toHaveAttribute("hidden");
  });
});

describe("revisionedCardArtUrl", () => {
  it("preserves existing query parameters and fragments", () => {
    expect(revisionedCardArtUrl("https://assets.example/card.webp?download=1#portrait", 8))
      .toBe("https://assets.example/card.webp?download=1&v=8#portrait");
  });
});
