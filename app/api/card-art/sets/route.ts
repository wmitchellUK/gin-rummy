import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import {
  createCardArtSet,
  listCardArtSets,
  requireCardArtEditor,
} from "@/src/server/card-art-service";

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return cardArtJson(await listCardArtSets(includeArchived));
  } catch (error) { return cardArtRouteError(error); }
}

export async function POST(request: Request) {
  try {
    await requireCardArtEditor();
    return cardArtJson(await createCardArtSet(await request.json().catch(() => null)), 201);
  } catch (error) { return cardArtRouteError(error); }
}
