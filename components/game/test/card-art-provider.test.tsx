import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardArtProvider, useCardArt } from "../card-art-provider";

function ManifestProbe() {
  const value = useCardArt();
  return <output aria-label="Active card art">{JSON.stringify(value)}</output>;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushRequests() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function manifest() {
  return JSON.parse(screen.getByLabelText("Active card art").textContent ?? "null") as {
    source: "BUILT_IN" | "CUSTOM";
    setId: string | null;
    setName: string | null;
    revision: number;
    manifest: Record<string, string>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CardArtProvider", () => {
  it("loads a partial manifest and drops invalid server entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      source: "CUSTOM",
      setId: "set-1",
      setName: "Portraits",
      revision: 4,
      manifest: {
        "J:CLUBS": "https://assets.example/jack.webp?v=4",
        "A:SPADES": "https://assets.example/ace.webp?v=4",
        "Q:HEARTS": 42,
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();

    expect(manifest()).toEqual({
      source: "CUSTOM",
      setId: "set-1",
      setName: "Portraits",
      revision: 4,
      manifest: { "J:CLUBS": "https://assets.example/jack.webp?v=4" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/card-art", expect.objectContaining({
      cache: "no-store",
      credentials: "same-origin",
    }));
  });

  it("polls every five seconds only while the page is visible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      source: "BUILT_IN",
      setId: null,
      setName: null,
      revision: 0,
      manifest: {},
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushRequests();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale response after a newer refresh has completed", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(response({
        source: "CUSTOM",
        setId: "set-new",
        setName: "New",
        revision: 9,
        manifest: { "K:SPADES": "https://assets.example/new.webp?v=9" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();

    setVisibility("hidden");
    setVisibility("visible");
    await flushRequests();
    expect(manifest().revision).toBe(9);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);

    resolveFirst(response({
      source: "CUSTOM",
      setId: "set-old",
      setName: "Old",
      revision: 3,
      manifest: { "J:CLUBS": "https://assets.example/old.webp?v=3" },
    }));
    await flushRequests();
    expect(manifest()).toEqual({
      source: "CUSTOM",
      setId: "set-new",
      setName: "New",
      revision: 9,
      manifest: { "K:SPADES": "https://assets.example/new.webp?v=9" },
    });
  });

  it("keeps the last successful manifest when polling encounters a network or HTTP failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        source: "CUSTOM",
        setId: "set-2",
        setName: "Portraits",
        revision: 2,
        manifest: { "Q:DIAMONDS": "https://assets.example/queen.webp?v=2" },
      }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();
    expect(manifest().revision).toBe(2);

    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushRequests();
    expect(manifest().revision).toBe(2);

    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushRequests();
    expect(manifest().revision).toBe(2);
  });

  it("ignores internally inconsistent active-set responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ source: "CUSTOM", setId: "set-4", setName: "Set four", revision: 4, manifest: { "K:CLUBS": "https://assets.example/k.webp?v=4" } }))
      .mockResolvedValueOnce(response({ source: "BUILT_IN", setId: null, setName: null, revision: 5, manifest: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();
    expect(manifest().revision).toBe(4);

    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushRequests();
    expect(manifest().revision).toBe(4);
  });

  it("publishes a newer revision on the next successful poll", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ source: "CUSTOM", setId: "set-3", setName: "Set three", revision: 1, manifest: { "J:HEARTS": "https://assets.example/j.webp?v=1" } }))
      .mockResolvedValueOnce(response({ source: "CUSTOM", setId: "set-3", setName: "Set three", revision: 2, manifest: { "J:HEARTS": "https://assets.example/j.webp?v=2" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardArtProvider><ManifestProbe /></CardArtProvider>);
    await flushRequests();
    expect(manifest().manifest["J:HEARTS"]).toContain("v=1");

    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushRequests();
    expect(manifest()).toMatchObject({
      revision: 2,
      manifest: { "J:HEARTS": "https://assets.example/j.webp?v=2" },
    });
  });
});
