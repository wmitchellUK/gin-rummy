"use client";

import Link from "next/link";
import Cropper, { type Area, type Point } from "react-easy-crop";
import {
  Archive,
  Check,
  Eye,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CardArtManifestProvider } from "@/components/game/card-art-provider";
import { CardFace, cardLabel } from "@/components/game/game-card";
import {
  FACE_CARD_RANKS,
  FACE_CARD_SUITS,
  type ActiveCardArtManifestResponse,
  type CardArtSetResponse,
  type CardArtSetsResponse,
  type FaceCardSlot,
} from "@/src/shared/card-art";
import type { PublicCard } from "@/src/shared/game-view";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PendingOperation =
  | { kind: "create" }
  | { kind: "rename"; setId: string }
  | { kind: "archive"; setId: string }
  | { kind: "remove"; setId: string; slot: FaceCardSlot }
  | { kind: "upload"; setId: string; slot: FaceCardSlot }
  | { kind: "activate"; setId: string | null };
type ActivationTarget = { kind: "builtin" } | { kind: "set"; set: CardArtSetResponse };
type CropDraft = {
  file: File;
  objectUrl: string;
  setId: string;
  slot: FaceCardSlot;
};

const SUIT_NAMES: Record<(typeof FACE_CARD_SUITS)[number], string> = {
  CLUBS: "Clubs",
  DIAMONDS: "Diamonds",
  HEARTS: "Hearts",
  SPADES: "Spades",
};
const SUIT_SYMBOLS: Record<(typeof FACE_CARD_SUITS)[number], string> = {
  CLUBS: "♣",
  DIAMONDS: "♦",
  HEARTS: "♥",
  SPADES: "♠",
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function manifestSource(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("v");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])v=[^&]*/g, "$1").replace(/[?&]$/, "");
  }
}

export function hasUnpublishedChanges(set: CardArtSetResponse): boolean {
  const draft = Object.entries(set.draftManifest).map(([slot, url]) => [slot, manifestSource(url)]).sort();
  const published = Object.entries(set.publishedManifest).map(([slot, url]) => [slot, manifestSource(url)]).sort();
  return JSON.stringify(draft) !== JSON.stringify(published);
}

export function cardArtErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    INVALID_SET_NAME: "Use a name between 1 and 80 characters.",
    IMAGE_TOO_LARGE: "Choose an image smaller than 10 MB.",
    UNSUPPORTED_IMAGE_TYPE: "Choose a JPEG, PNG, or WebP image.",
    INVALID_IMAGE: "That image could not be read. Try a different file.",
    INVALID_CROP: "The crop could not be processed. Reset it and try again.",
    SET_NOT_FOUND: "This set no longer exists. Refresh the studio to continue.",
    SET_ARCHIVED: "This set was archived elsewhere and can no longer be changed.",
    ACTIVE_SET_ARCHIVE: "The active set cannot be archived. Activate another design first.",
    DRAFT_CONFLICT: "This draft changed elsewhere. Your current work is still here; refresh before trying again.",
    ACTIVATION_CONFLICT: "This set changed before it could be published. Your draft is still here; refresh and review it.",
  };
  return messages[code] ?? "Something went wrong. Your changes were not lost; please try again.";
}

async function requestJson<T>(fetcher: Fetcher, path: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(path, { cache: "no-store", credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
  if (!response.ok) throw new Error(body.error?.code ?? "REQUEST_FAILED");
  return body as T;
}

export function CardStudio({ fetcher = fetch }: { fetcher?: Fetcher }) {
  const [catalog, setCatalog] = useState<CardArtSetsResponse>();
  const [selectedId, setSelectedId] = useState<string>("");
  const [pending, setPending] = useState<PendingOperation>();
  const [loadError, setLoadError] = useState("");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [slotErrors, setSlotErrors] = useState<Partial<Record<FaceCardSlot, string>>>({});
  const [cropDraft, setCropDraft] = useState<CropDraft>();
  const [previewSlot, setPreviewSlot] = useState<FaceCardSlot>();
  const [activationTarget, setActivationTarget] = useState<ActivationTarget>();
  const [activationError, setActivationError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const requestedUploadSlot = useRef<FaceCardSlot | undefined>(undefined);

  const selectedSet = useMemo(
    () => catalog?.sets.find((set) => set.id === selectedId),
    [catalog, selectedId],
  );
  const busy = pending !== undefined;

  async function loadCatalog() {
    setLoadError("");
    try {
      const next = await requestJson<CardArtSetsResponse>(fetcher, "/api/card-art/sets?includeArchived=true");
      setCatalog(next);
      setSelectedId((current) => {
        if (current === "builtin" || next.sets.some((set) => set.id === current)) return current;
        return next.activeSetId ?? next.sets.find((set) => !set.archivedAt)?.id ?? "builtin";
      });
    } catch (cause) {
      setLoadError(cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"));
    }
  }

  useEffect(() => { void loadCatalog(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRenameName(selectedSet?.name ?? "");
    setRenameError("");
    setArchiveError("");
    setSlotErrors({});
  }, [selectedSet?.id, selectedSet?.name]);

  function replaceSet(nextSet: CardArtSetResponse) {
    setCatalog((current) => current && ({
      ...current,
      sets: current.sets.map((set) => set.id === nextSet.id ? nextSet : set),
    }));
  }

  async function createSet(event: FormEvent) {
    event.preventDefault();
    setCreateError("");
    setPending({ kind: "create" });
    try {
      const created = await requestJson<CardArtSetResponse>(fetcher, "/api/card-art/sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createName }),
      });
      setCatalog((current) => current && ({ ...current, sets: [created, ...current.sets] }));
      setCreateName("");
      setSelectedId(created.id);
    } catch (cause) {
      setCreateError(cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"));
    } finally { setPending(undefined); }
  }

  async function renameSet(event: FormEvent) {
    event.preventDefault();
    if (!selectedSet) return;
    setRenameError("");
    setPending({ kind: "rename", setId: selectedSet.id });
    try {
      replaceSet(await requestJson<CardArtSetResponse>(fetcher, `/api/card-art/sets/${selectedSet.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: renameName }),
      }));
    } catch (cause) {
      setRenameError(cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"));
    } finally { setPending(undefined); }
  }

  async function archiveSet() {
    if (!selectedSet || selectedSet.isActive) return;
    setArchiveError("");
    setPending({ kind: "archive", setId: selectedSet.id });
    try {
      replaceSet(await requestJson<CardArtSetResponse>(fetcher, `/api/card-art/sets/${selectedSet.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      }));
    } catch (cause) {
      setArchiveError(cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"));
    } finally { setPending(undefined); }
  }

  function chooseFile(slot: FaceCardSlot) {
    requestedUploadSlot.current = slot;
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }

  function receiveFile(file?: File) {
    const slot = requestedUploadSlot.current;
    if (!file || !slot || !selectedSet) return;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setSlotErrors((current) => ({ ...current, [slot]: cardArtErrorMessage("UNSUPPORTED_IMAGE_TYPE") }));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setSlotErrors((current) => ({ ...current, [slot]: cardArtErrorMessage("IMAGE_TOO_LARGE") }));
      return;
    }
    setSlotErrors((current) => ({ ...current, [slot]: undefined }));
    setCropDraft({ file, objectUrl: URL.createObjectURL(file), setId: selectedSet.id, slot });
  }

  function closeCrop() {
    if (cropDraft) URL.revokeObjectURL(cropDraft.objectUrl);
    setCropDraft(undefined);
  }

  async function removeSlot(slot: FaceCardSlot) {
    if (!selectedSet) return;
    setSlotErrors((current) => ({ ...current, [slot]: undefined }));
    setPending({ kind: "remove", setId: selectedSet.id, slot });
    try {
      replaceSet(await requestJson<CardArtSetResponse>(fetcher, `/api/card-art/sets/${selectedSet.id}/slots/${slot}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedDraftVersion: selectedSet.draftVersion }),
      }));
    } catch (cause) {
      setSlotErrors((current) => ({
        ...current,
        [slot]: cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"),
      }));
    } finally { setPending(undefined); }
  }

  async function uploadCrop(crop: { x: number; y: number; width: number; height: number }) {
    if (!cropDraft || !selectedSet || selectedSet.id !== cropDraft.setId) return;
    setPending({ kind: "upload", setId: cropDraft.setId, slot: cropDraft.slot });
    setSlotErrors((current) => ({ ...current, [cropDraft.slot]: undefined }));
    try {
      const formData = new FormData();
      formData.set("image", cropDraft.file);
      formData.set("crop", JSON.stringify(crop));
      formData.set("expectedDraftVersion", String(selectedSet.draftVersion));
      replaceSet(await requestJson<CardArtSetResponse>(fetcher, `/api/card-art/sets/${cropDraft.setId}/slots/${cropDraft.slot}`, {
        method: "POST",
        body: formData,
      }));
      closeCrop();
    } catch (cause) {
      setSlotErrors((current) => ({
        ...current,
        [cropDraft.slot]: cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"),
      }));
    } finally { setPending(undefined); }
  }

  async function activate() {
    if (!activationTarget) return;
    setActivationError("");
    const set = activationTarget.kind === "set" ? activationTarget.set : undefined;
    setPending({ kind: "activate", setId: set?.id ?? null });
    try {
      const result = await requestJson<ActiveCardArtManifestResponse>(
        fetcher,
        set ? `/api/card-art/sets/${set.id}/activate` : "/api/card-art/default/activate",
        set ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedDraftVersion: set.draftVersion,
            expectedPublishedRevision: set.publishedRevision,
          }),
        } : { method: "POST" },
      );
      setCatalog((current) => current && ({
        activeSetId: result.setId,
        activeRevision: result.revision,
        sets: current.sets.map((item) => ({
          ...item,
          isActive: item.id === result.setId,
          ...(item.id === result.setId ? {
            publishedManifest: item.draftManifest,
            publishedRevision: result.revision,
          } : {}),
        })),
      }));
      setActivationTarget(undefined);
    } catch (cause) {
      setActivationError(cardArtErrorMessage(cause instanceof Error ? cause.message : "REQUEST_FAILED"));
    } finally { setPending(undefined); }
  }

  if (!catalog) {
    return <main className="studio-shell">
      <section className="studio-loading" aria-live="polite">
        <Link className="wordmark" href="/">Gin <span>Rummy</span></Link>
        {loadError ? <><p role="alert">{loadError}</p><button className="studio-button primary" onClick={() => void loadCatalog()}>Try again</button></> : <p role="status">Opening Card Studio…</p>}
      </section>
    </main>;
  }

  return <main className="studio-shell">
    <div className="studio-frame">
      <header className="studio-header">
        <Link className="wordmark" href="/">Gin <span>Rummy</span></Link>
        <div>
          <p className="eyebrow">Artwork workshop</p>
          <h1>Card Studio</h1>
        </div>
        <Link className="studio-home-link" href="/">Return to lobby</Link>
      </header>

      <div className="studio-layout">
        <aside className="studio-sidebar" aria-labelledby="design-sets-title">
          <div className="studio-section-heading">
            <div><p className="eyebrow">Collection</p><h2 id="design-sets-title">Design sets</h2></div>
            <span>{catalog.sets.length + 1}</span>
          </div>
          <nav className="studio-set-list" aria-label="Card design sets">
            <button
              className={`studio-set-row ${selectedId === "builtin" ? "selected" : ""}`}
              aria-current={selectedId === "builtin" ? "true" : undefined}
              onClick={() => setSelectedId("builtin")}
              disabled={busy}
            >
              <span className="studio-set-icon" aria-hidden="true">GR</span>
              <span><b>Built-in court</b><small>Original card design</small></span>
              {catalog.activeSetId === null && <span className="status-chip active"><Check /> Active</span>}
            </button>
            {catalog.sets.map((set) => <button
              key={set.id}
              className={`studio-set-row ${selectedId === set.id ? "selected" : ""}`}
              aria-current={selectedId === set.id ? "true" : undefined}
              onClick={() => setSelectedId(set.id)}
              disabled={busy}
            >
              <span className="studio-set-icon" aria-hidden="true">{set.name.slice(0, 2).toUpperCase()}</span>
              <span><b>{set.name}</b><small>{set.archivedAt ? "Archived" : hasUnpublishedChanges(set) ? "Draft changes" : set.publishedRevision ? `Published r${set.publishedRevision}` : "Draft"}</small></span>
              {set.isActive && <span className="status-chip active"><Check /> Active</span>}
              {!set.isActive && set.archivedAt && <span className="status-chip archived">Archived</span>}
            </button>)}
          </nav>
          <form className="studio-create-form" onSubmit={createSet}>
            <label htmlFor="new-set-name">New set name</label>
            <div><input id="new-set-name" value={createName} maxLength={80} onChange={(event) => setCreateName(event.target.value)} disabled={busy} /><button className="studio-icon-button" aria-label="Create set" disabled={busy || !createName.trim()}><Plus /></button></div>
            {createError && <p className="control-error" role="alert">{createError}</p>}
          </form>
        </aside>

        <section className="studio-workspace" aria-live="polite">
          {selectedSet ? <SetWorkspace
            set={selectedSet}
            busy={busy}
            pending={pending}
            renameName={renameName}
            renameError={renameError}
            archiveError={archiveError}
            slotErrors={slotErrors}
            onRenameName={setRenameName}
            onRename={renameSet}
            onArchive={() => void archiveSet()}
            onPreview={setPreviewSlot}
            onUpload={chooseFile}
            onRemove={(slot) => void removeSlot(slot)}
            onActivate={() => { setActivationError(""); setActivationTarget({ kind: "set", set: selectedSet }); }}
          /> : <BuiltinWorkspace
            active={catalog.activeSetId === null}
            busy={busy}
            onPreview={setPreviewSlot}
            onActivate={() => { setActivationError(""); setActivationTarget({ kind: "builtin" }); }}
          />}
        </section>
      </div>
    </div>

    <input ref={fileInput} className="visually-hidden" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => receiveFile(event.target.files?.[0])} />
    {cropDraft && <CropDialog draft={cropDraft} busy={pending?.kind === "upload"} error={slotErrors[cropDraft.slot]} onClose={closeCrop} onUpload={uploadCrop} />}
    {previewSlot && <PreviewDialog slot={previewSlot} manifest={selectedSet?.draftManifest ?? {}} onClose={() => setPreviewSlot(undefined)} />}
    {activationTarget && <ActivationDialog target={activationTarget} busy={pending?.kind === "activate"} error={activationError} onClose={() => setActivationTarget(undefined)} onConfirm={() => void activate()} />}
  </main>;
}

function SetWorkspace(props: {
  set: CardArtSetResponse;
  busy: boolean;
  pending?: PendingOperation;
  renameName: string;
  renameError: string;
  archiveError: string;
  slotErrors: Partial<Record<FaceCardSlot, string>>;
  onRenameName: (value: string) => void;
  onRename: (event: FormEvent) => void;
  onArchive: () => void;
  onPreview: (slot: FaceCardSlot) => void;
  onUpload: (slot: FaceCardSlot) => void;
  onRemove: (slot: FaceCardSlot) => void;
  onActivate: () => void;
}) {
  const { set } = props;
  const unpublished = hasUnpublishedChanges(set);
  const locked = Boolean(set.archivedAt);
  const activeArchiveHelp = `${set.id}-archive-help`;
  return <>
    <div className="studio-workspace-head">
      <div>
        <div className="studio-title-line"><h2>{set.name}</h2>{set.isActive && <span className="status-chip active"><Check /> Active globally</span>}{locked && <span className="status-chip archived">Archived</span>}</div>
        <p>{unpublished ? "Unpublished changes are saved in this draft." : set.publishedRevision ? "Draft matches the published design." : "This set has not been published yet."}</p>
      </div>
      <div className="revision-panel">
        <span>Published revision</span>
        <strong>{set.publishedRevision ? `r${set.publishedRevision}` : "—"}</strong>
        <small>{unpublished ? "Draft ahead" : set.publishedRevision ? "Up to date" : "Unpublished"}</small>
      </div>
    </div>

    <div className="studio-set-controls">
      <form onSubmit={props.onRename}>
        <label htmlFor="rename-set">Set name</label>
        <div><input id="rename-set" maxLength={80} value={props.renameName} onChange={(event) => props.onRenameName(event.target.value)} disabled={props.busy || locked} /><button className="studio-button subtle" disabled={props.busy || locked || !props.renameName.trim() || props.renameName.trim() === set.name}><Pencil /> Rename</button></div>
        {props.renameError && <p className="control-error" role="alert">{props.renameError}</p>}
      </form>
      <div className="studio-publish-controls">
        <button className="studio-button danger" onClick={props.onArchive} disabled={props.busy || locked || set.isActive} aria-describedby={set.isActive ? activeArchiveHelp : undefined}><Archive /> Archive</button>
        <button className="studio-button primary" onClick={props.onActivate} disabled={props.busy || locked}><Upload /> {set.isActive && !unpublished ? "Publish new revision" : "Activate for all games"}</button>
        {set.isActive && <p id={activeArchiveHelp} className="control-help">Active sets cannot be archived. Activate another design first.</p>}
        {props.archiveError && <p className="control-error" role="alert">{props.archiveError}</p>}
      </div>
    </div>

    <div className="studio-grid-heading"><div><p className="eyebrow">Face-card artwork</p><h3>Jack, Queen &amp; King</h3></div><p>Transparent PNG preferred · JPEG, PNG, or WebP · 10 MB maximum</p></div>
    <CardGrid manifest={set.draftManifest} disabled={props.busy || locked} slotErrors={props.slotErrors} pending={props.pending} onPreview={props.onPreview} onUpload={props.onUpload} onRemove={props.onRemove} />
  </>;
}

function BuiltinWorkspace({ active, busy, onPreview, onActivate }: { active: boolean; busy: boolean; onPreview: (slot: FaceCardSlot) => void; onActivate: () => void }) {
  return <>
    <div className="studio-workspace-head">
      <div><div className="studio-title-line"><h2>Built-in court</h2>{active && <span className="status-chip active"><Check /> Active globally</span>}</div><p>The original illustrated court cards are always available and cannot be edited.</p></div>
      <div className="revision-panel"><span>Published revision</span><strong>Base</strong><small>Built in</small></div>
    </div>
    <div className="builtin-banner"><span className="studio-set-icon" aria-hidden="true">GR</span><div><h3>Original Gin Rummy design</h3><p>Restore the cream, ink, and suit-colored court treatment across every table.</p></div><button className="studio-button primary" onClick={onActivate} disabled={busy || active}>{active ? "Currently active" : "Activate for all games"}</button></div>
    <div className="studio-grid-heading"><div><p className="eyebrow">Built-in preview</p><h3>Jack, Queen &amp; King</h3></div></div>
    <CardGrid manifest={{}} disabled slotErrors={{}} onPreview={onPreview} onUpload={() => undefined} onRemove={() => undefined} />
  </>;
}

function CardGrid(props: {
  manifest: CardArtSetResponse["draftManifest"];
  disabled: boolean;
  slotErrors: Partial<Record<FaceCardSlot, string>>;
  pending?: PendingOperation;
  onPreview: (slot: FaceCardSlot) => void;
  onUpload: (slot: FaceCardSlot) => void;
  onRemove: (slot: FaceCardSlot) => void;
}) {
  const art: ActiveCardArtManifestResponse = {
    source: "CUSTOM",
    setId: "studio-preview",
    setName: "Studio preview",
    revision: 1,
    manifest: props.manifest,
  };
  return <CardArtManifestProvider value={art}>
    <div className="card-art-grid" role="grid" aria-label="Face card artwork by rank and suit">
      {FACE_CARD_SUITS.map((suit) => <div className={`suit-heading ${suit === "HEARTS" || suit === "DIAMONDS" ? "red" : ""}`} role="columnheader" key={suit}><span aria-hidden="true">{SUIT_SYMBOLS[suit]}</span> {SUIT_NAMES[suit]}</div>)}
      {FACE_CARD_RANKS.flatMap((rank) => FACE_CARD_SUITS.map((suit) => {
        const slot = `${rank}:${suit}` as FaceCardSlot;
        const card = { id: slot, rank, suit } as PublicCard;
        const custom = Boolean(props.manifest[slot]);
        const removing = props.pending?.kind === "remove" && props.pending.slot === slot;
        return <article className="card-art-cell" role="gridcell" aria-label={cardLabel(card)} key={slot}>
          <div className="card-art-cell-head"><b>{rank}</b><span>{custom ? "Custom" : "Built in"}</span></div>
          <div className="studio-card-preview" role="img" aria-label={`${cardLabel(card)} preview`}><CardFace card={card} /></div>
          <div className="card-art-actions">
            <button aria-label={`Preview ${cardLabel(card)}`} onClick={() => props.onPreview(slot)}><Eye /> Preview</button>
            <button aria-label={`${custom ? "Replace" : "Upload"} ${cardLabel(card)} artwork`} onClick={() => props.onUpload(slot)} disabled={props.disabled}><ImagePlus /> {custom ? "Replace" : "Upload"}</button>
            <button aria-label={`Remove ${cardLabel(card)} artwork`} onClick={() => props.onRemove(slot)} disabled={props.disabled || !custom}><Trash2 /> {removing ? "Removing…" : "Remove"}</button>
          </div>
          {props.slotErrors[slot] && <p className="control-error" role="alert">{props.slotErrors[slot]}</p>}
        </article>;
      }))}
    </div>
  </CardArtManifestProvider>;
}

function AccessibleDialog({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const backdrop = root?.parentElement;
    const backgroundSiblings = Array.from(backdrop?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({ element, ariaHidden: element.getAttribute("aria-hidden"), inert: element.inert }));
    backgroundSiblings.forEach(({ element }) => {
      element.setAttribute("aria-hidden", "true");
      element.inert = true;
    });
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      root?.removeEventListener("keydown", onKeyDown);
      backgroundSiblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        element.inert = inert;
      });
      previouslyFocused?.focus();
    };
  }, []);
  return <div className="studio-dialog-backdrop">
    <div ref={dialog} className={`studio-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="studio-dialog-head"><h2 id={titleId}>{title}</h2><button className="studio-icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X /></button></div>
      {children}
    </div>
  </div>;
}

function CropDialog({ draft, busy, error, onClose, onUpload }: { draft: CropDraft; busy: boolean; error?: string; onClose: () => void; onUpload: (crop: { x: number; y: number; width: number; height: number }) => Promise<void> }) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area>();
  const [showPreview, setShowPreview] = useState(false);
  function cropComplete(percentages: Area) {
    setArea({ x: percentages.x / 100, y: percentages.y / 100, width: percentages.width / 100, height: percentages.height / 100 });
  }
  function reset() { setCrop({ x: 0, y: 0 }); setZoom(1); setShowPreview(false); }
  return <AccessibleDialog title={`Crop ${draft.slot.replace(":", " of ").toLowerCase()}`} onClose={onClose} busy={busy} wide>
    <p className="dialog-copy">Pan and zoom until the subjects fit comfortably inside the locked 2:3 frame. Transparent pixels remain transparent on the cream card stock, with the gold frame layered separately.</p>
    <div className={`crop-layout ${showPreview ? "show-preview" : ""}`}>
      <div className="crop-stage" aria-label="Crop image">
        <Cropper image={draft.objectUrl} crop={crop} zoom={zoom} minZoom={1} maxZoom={3} aspect={2 / 3} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={cropComplete} showGrid={!showPreview} />
      </div>
      {showPreview && <div className="crop-preview" aria-label="Cropped artwork preview">
        <span>Preview</span>
        <div className="crop-preview-card">
          {/* Blob URLs are local editing previews and cannot use the Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.objectUrl}
            alt="Cropped portrait preview"
            style={area ? {
              width: `${100 / area.width}%`,
              height: `${100 / area.height}%`,
              left: `${-100 * area.x / area.width}%`,
              top: `${-100 * area.y / area.height}%`,
            } : undefined}
          />
        </div>
      </div>}
    </div>
    <label className="zoom-control" htmlFor="crop-zoom"><span>Zoom</span><input id="crop-zoom" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={busy} /><output>{zoom.toFixed(2)}×</output></label>
    {error && <p className="control-error dialog-error" role="alert">{error}</p>}
    <div className="studio-dialog-actions">
      <button className="studio-button subtle" onClick={reset} disabled={busy}><RotateCcw /> Reset</button>
      <button className="studio-button subtle" onClick={() => setShowPreview((current) => !current)} disabled={busy}><Eye /> {showPreview ? "Adjust crop" : "Preview"}</button>
      <button className="studio-button subtle" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="studio-button primary" onClick={() => area && void onUpload(area)} disabled={busy || !area}><Upload /> {busy ? "Uploading…" : "Upload crop"}</button>
    </div>
  </AccessibleDialog>;
}

function PreviewDialog({ slot, manifest, onClose }: { slot: FaceCardSlot; manifest: CardArtSetResponse["draftManifest"]; onClose: () => void }) {
  const [rank, suit] = slot.split(":") as [(typeof FACE_CARD_RANKS)[number], (typeof FACE_CARD_SUITS)[number]];
  const card = { id: slot, rank, suit } as PublicCard;
  return <AccessibleDialog title={`${cardLabel(card)} preview`} onClose={onClose}>
    <CardArtManifestProvider value={{
      source: "CUSTOM",
      setId: "preview",
      setName: "Studio preview",
      revision: 1,
      manifest,
    }}>
      <div className="dialog-card-preview" role="img" aria-label={`${cardLabel(card)} full preview`}><CardFace card={card} /></div>
    </CardArtManifestProvider>
    <p className="dialog-copy">Rank, suit, cream stock, and corner indices stay part of the Gin Rummy card design.</p>
    <div className="studio-dialog-actions"><button className="studio-button primary" onClick={onClose}>Done</button></div>
  </AccessibleDialog>;
}

function ActivationDialog({ target, busy, error, onClose, onConfirm }: { target: ActivationTarget; busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const name = target.kind === "builtin" ? "Built-in court" : target.set.name;
  return <AccessibleDialog title={`Activate ${name}?`} onClose={onClose} busy={busy}>
    <div className="activation-notice"><Check /><p><strong>This is a global change.</strong> All open games will update to this design, and every future game will use it too.</p></div>
    {target.kind === "set" && hasUnpublishedChanges(target.set) && <p className="dialog-copy">The current draft will be published as a new revision before it becomes active.</p>}
    {error && <p className="control-error dialog-error" role="alert">{error}</p>}
    <div className="studio-dialog-actions"><button className="studio-button subtle" onClick={onClose} disabled={busy}>Cancel</button><button className="studio-button primary" onClick={onConfirm} disabled={busy}>{busy ? "Activating…" : "Yes, activate globally"}</button></div>
  </AccessibleDialog>;
}
