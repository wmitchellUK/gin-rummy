import { GameScreen } from "@/components/game/game-screen";

// A game id is request-specific; this page must not be prerendered as a cache entry.
export const instant = false;

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameScreen gameId={gameId} />;
}
