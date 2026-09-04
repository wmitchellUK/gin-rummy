"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  sanitizeFaceCardManifest,
  type ActiveCardArtManifestResponse,
} from "@/src/shared/card-art";

const CARD_ART_POLL_INTERVAL_MS = 5_000;
const BUILTIN_CARD_ART: ActiveCardArtManifestResponse = {
  source: "BUILT_IN",
  setId: null,
  setName: null,
  revision: 0,
  manifest: {},
};

const CardArtContext = createContext<ActiveCardArtManifestResponse>(BUILTIN_CARD_ART);

function parseCardArtResponse(value: unknown): ActiveCardArtManifestResponse | undefined {
  if (!value || typeof value !== "object") return;
  const response = value as Record<string, unknown>;
  if (response.source !== "BUILT_IN" && response.source !== "CUSTOM") return;
  if (response.setId !== null && typeof response.setId !== "string") return;
  if (response.setName !== null && typeof response.setName !== "string") return;
  if (!Number.isSafeInteger(response.revision) || (response.revision as number) < 0) return;
  if ((response.setId === null) !== (response.revision === 0)) return;
  if (response.source === "BUILT_IN" && (response.setId !== null || response.setName !== null)) return;
  if (response.source === "CUSTOM" && (typeof response.setId !== "string" || typeof response.setName !== "string")) return;
  if (!response.manifest || typeof response.manifest !== "object" || Array.isArray(response.manifest)) return;

  return {
    source: response.source,
    setId: response.setId,
    setName: response.setName,
    revision: response.revision as number,
    manifest: sanitizeFaceCardManifest(response.manifest),
  };
}

export function CardArtProvider({ children }: { children: ReactNode }) {
  const [cardArt, setCardArt] = useState<ActiveCardArtManifestResponse>(BUILTIN_CARD_ART);

  useEffect(() => {
    let active = true;
    let requestController: AbortController | undefined;
    let timer: number | undefined;

    async function refresh() {
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      try {
        const response = await fetch("/api/card-art", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const next = parseCardArtResponse(await response.json().catch(() => undefined));
        if (active && requestController === controller && next) setCardArt(next);
      } catch {
        // Artwork is optional. Preserve the last successful manifest on transient failures.
      } finally {
        if (requestController === controller) requestController = undefined;
      }
    }

    function stopPolling() {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      requestController?.abort();
      requestController = undefined;
    }

    function startPolling() {
      stopPolling();
      void refresh();
      timer = window.setInterval(() => void refresh(), CARD_ART_POLL_INTERVAL_MS);
    }

    function visibilityChanged() {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    }

    document.addEventListener("visibilitychange", visibilityChanged);
    if (document.visibilityState === "visible") startPolling();

    return () => {
      active = false;
      stopPolling();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  return <CardArtContext.Provider value={cardArt}>{children}</CardArtContext.Provider>;
}

export function useCardArt(): ActiveCardArtManifestResponse {
  return useContext(CardArtContext);
}

/** Allows previews and component tests to render against a known published manifest. */
export function CardArtManifestProvider({
  value,
  children,
}: {
  value: ActiveCardArtManifestResponse;
  children: ReactNode;
}) {
  return <CardArtContext.Provider value={value}>{children}</CardArtContext.Provider>;
}
