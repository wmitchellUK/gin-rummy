"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.code ?? "REQUEST_FAILED");
  return body;
}

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await ensureAnonymousSession();
        const body = await request("/api/me") as { player?: { displayName?: string | null } };
        if (!active) return;
        setName(body.player?.displayName ?? "");
        setReady(true);
      } catch {
        if (active) setError("We couldn’t prepare your player. Try again.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const profile = await request("/api/profile", { method: "POST", body: JSON.stringify({ displayName: name }) }) as { displayName: string };
      setName(profile.displayName);
      setNotice("Name saved. This affects new games only.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "INVALID_DISPLAY_NAME" ? "Enter a name between 1 and 40 characters." : "We couldn’t save your name. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="game-shell"><section className="simple-panel" aria-labelledby="settings-title">
    <div className="lobby-heading"><h1 id="settings-title">Settings</h1><Link href="/">Back to lobby</Link></div>
    {!ready ? <p role={error ? "alert" : "status"}>{error || "Preparing your table…"}</p> : <form onSubmit={save}>
      <label>Change your name<input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
      <p>This affects new games only.</p><button disabled={saving}>{saving ? "Saving…" : "Save name"}</button>
    </form>}
    {notice && <p className="game-notice" role="status">{notice}</p>}
  </section></main>;
}
