import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import { getActiveCardArtManifest } from "@/src/server/card-art-service";

export async function GET() {
  try { return cardArtJson(await getActiveCardArtManifest()); }
  catch (error) { return cardArtRouteError(error); }
}
