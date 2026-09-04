import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import { activateBuiltinCardArt, requireCardArtEditor } from "@/src/server/card-art-service";

export async function POST() {
  try {
    await requireCardArtEditor();
    return cardArtJson(await activateBuiltinCardArt());
  } catch (error) { return cardArtRouteError(error); }
}
