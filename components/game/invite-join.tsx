"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous";

type JoinState = "INITIALIZING" | "NEEDS_NAME" | "READY_TO_JOIN" | "JOINING" | "FULL" | "UNAVAILABLE" | "ERROR";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.code ?? "REQUEST_FAILED");
  return body;
}

export function InviteJoin({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<JoinState>("INITIALIZING");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await ensureAnonymousSession();
        const [me, invite] = await Promise.all([
          request("/api/me") as Promise<{ player?: { displayName: string | null } }>,
          request(`/api/invites/${token}`) as Promise<{ state?: string; gameId?: string }>,
        ]);
        if (!active) return;
        if (invite.state === "ALREADY_A_PLAYER" && invite.gameId) {
          router.replace(`/game/${invite.gameId}`);
          return;
        }
        if (invite.state === "FULL") return setState("FULL");
        if (invite.state !== "OPEN") return setState("UNAVAILABLE");
        const savedName = me.player?.displayName ?? null;
        setDisplayName(savedName);
        setState(savedName ? "READY_TO_JOIN" : "NEEDS_NAME");
      } catch {
        if (active) setState("ERROR");
      }
    })();
    return () => { active = false; };
  }, [router, token]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const profile = await request("/api/profile", { method: "POST", body: JSON.stringify({ displayName: name }) }) as { displayName: string };
      setDisplayName(profile.displayName);
      setState("READY_TO_JOIN");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "INVALID_DISPLAY_NAME" ? "Enter a name between 1 and 40 characters." : "We couldn’t save your name. Try again.");
    }
  }

  async function join() {
    if (!displayName || state !== "READY_TO_JOIN") return;
    setState("JOINING");
    setError("");
    try {
      const result = await request(`/api/invites/${token}/join`, { method: "POST" }) as { state?: string; game?: { gameId: string }; gameId?: string };
      if (result.state === "JOINED" && result.game) return router.replace(`/game/${result.game.gameId}`);
      if (result.state === "ALREADY_A_PLAYER" && result.gameId) return router.replace(`/game/${result.gameId}`);
      setState("FULL");
    } catch (cause) {
      if (cause instanceof Error && cause.message === "PROFILE_NAME_REQUIRED") return setState("NEEDS_NAME");
      if (cause instanceof Error && cause.message === "INVITE_UNAVAILABLE") return setState("UNAVAILABLE");
      setError("We couldn’t join this game. Try again.");
      setState("READY_TO_JOIN");
    }
  }

  if (state === "INITIALIZING") return <main className="game-shell"><p className="simple-panel" role="status">Preparing your table…</p></main>;
  if (state === "FULL") return <Message title="This game already has two players." action="Return home" onAction={() => router.replace("/")} />;
  if (state === "UNAVAILABLE") return <Message title="This invite is no longer available." action="Return home" onAction={() => router.replace("/")} />;
  if (state === "ERROR") return <Message title="We couldn’t prepare your player. Try again." action="Retry" onAction={() => window.location.reload()} />;
  if (state === "NEEDS_NAME") return <main className="game-shell"><section className="simple-panel" aria-labelledby="name-title">
    <h1 id="name-title">What should we call you?</h1><p>You’ll use this name in this and future games.</p>
    <form onSubmit={saveName}><label>Your name<input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label><button>Continue</button></form>
    {error && <p className="game-error" role="alert">{error}</p>}
  </section></main>;
  return <main className="game-shell"><section className="simple-panel" aria-labelledby="join-title">
    <h1 id="join-title">Join game</h1><p>You’ll be seated as {displayName}.</p>
    <button onClick={() => void join()} disabled={state === "JOINING"}>{state === "JOINING" ? "Joining game…" : "Join game"}</button>
    {error && <p className="game-error" role="alert">{error}</p>}
  </section></main>;
}

function Message({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <main className="game-shell"><section className="simple-panel"><h1>{title}</h1><button onClick={onAction}>{action}</button></section></main>;
}
