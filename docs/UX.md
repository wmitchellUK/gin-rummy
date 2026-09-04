# Gin Rummy UX Specification

## Intent

The game table should feel like a quiet, premium physical Gin Rummy table, not a casino or a dashboard. The player’s cards are the primary visual object; turn state and the two public piles make the next decision obvious. This document specifies the v1 UI only. Rules, legality, scoring, and the player-safe state projection remain server-owned.

## Visual reference analysis

`docs/assets/gin-ui-reference.png` is successful because its desktop composition gives every object a natural place at a card table: the opponent and their concealed hand sit across the felt, the two piles form a calm central focal point, and the large, face-up player hand is anchored at the near edge. The low curved wood rail subtly frames that hand rather than competing with it. Information is sparse and grouped by decision: score/identity at each player, piles together, a compact turn prompt beside them, and actions close to the active hand.

The dark, lightly textured green felt gives depth without visual noise. Warm almost-black wood surrounds it, while thin muted-gold rules, type, and borders provide hierarchy; gold is an accent, not a fill color. Cream cards, narrow dark outlines, generous proportions, and high-contrast black/red pips make the cards feel tactile and readable. The opponent’s card backs are evenly overlapped; the player’s hand is a shallow fan with readable rank corners. The small score panel and green-dot turn prompt are compact, text-led status treatments. Buttons are rectangular, weighty, and material-like, with green as the primary action and warm brown as the discard action; the action area shows only choices relevant to the current phase and selection.

The supplied end-of-hand example succeeds as a focused overlay: it freezes the table behind a dark surface, names the outcome, then explains the two players’ score calculation before asking for the next commitment. Its mobile view preserves the same hierarchy by stacking opponent, piles, status, player hand, and actions—not by shrinking desktop wholesale. Preserve these relationships and materials, but use real text/status, accessible controls, and responsive sizing instead of relying on ornament or color alone.

## Design tokens

Use CSS custom properties/Tailwind theme equivalents. Texture, if used, must be extremely subtle and must not reduce contrast.

| Token | Value | Use |
| --- | --- | --- |
| `--felt-950` | `#062D21` | page/table outer field |
| `--felt-900` | `#164E3A` | primary felt surface |
| `--felt-800` | `#1D6248` | raised/selected felt surfaces |
| `--wood-950` | `#21150F` | outer wood / deep rail |
| `--wood-800` | `#5C4033` | wood grain/highlight |
| `--gold-500` | `#D4AF37` | restrained accent, active outline |
| `--gold-300` | `#E6C86E` | gold text on dark surfaces |
| `--cream-50` | `#FFFDF7` | card face |
| `--cream-100` | `#F2E9D8` | panels and secondary surface |
| `--ink-950` | `#171612` | card text / dark text on cream |
| `--text-on-dark` | `#F8F1E4` | primary table text |
| `--text-muted` | `#CFC3AE` | secondary table text |
| `--red` | `#B52D2D` | hearts/diamonds; never state alone |
| `--success` | `#55B96C` | connected/current-turn dot with text |
| `--danger` | `#D9685C` | errors only |

- Typography: `Playfair Display, Georgia, serif` for the wordmark, outcomes, and score numerals; `Inter, ui-sans-serif, system-ui, sans-serif` for all controls and explanatory text. Avoid decorative type inside cards; use a legible card-face serif/sans fallback with tabular numerals.
- Type scale: wordmark 28/32 desktop, 22/26 mobile; result title 28/34; score 24/28; body/control 15/20; supporting text 13/18. Use weight 600 for controls and score labels, 400–500 otherwise.
- Spacing: 4px base; use 8, 12, 16, 24, 32, 48. Table inset is 24px desktop / 16px mobile. Controls have at least 44px height and 12px horizontal padding.
- Radius: cards 8px; controls/panels 10px; table frame 24px desktop / 18px mobile; status dot circular. Do not use exaggerated pills except compact status tags.
- Shadows: card `0 3px 8px rgb(0 0 0 / 28%)`; lifted/selected card `0 10px 20px rgb(0 0 0 / 35%)`; panel `0 4px 12px rgb(0 0 0 / 28%)`; inner wood/felt edge `inset 0 1px rgb(255 255 255 / 10%), inset 0 -3px 8px rgb(0 0 0 / 30%)`.
- Cards: desktop player card 76×112px; desktop opponent/pile card 64×94px; mobile player card 60×88px (scaling to 64×94px at 390px+); mobile pile 54×80px. Preserve an aspect ratio of about 0.68. Mobile corner indices are 14–15px and every rank/suit corner remains visible even when the hand overlaps.

## Layout and responsive behavior

`GameTable` is the full game scene: a dark outer background, wood frame/rail, then an inset felt play area. It is a centered desktop table with a practical maximum width around 1440px and `min-height: 760px`; it becomes a vertically scrolling, 100%-width felt surface below 768px. The rail is framing, not a navigation container; keep its decoration lighter on mobile.

| Area | Desktop (>= 768px) | Mobile (~375px) |
| --- | --- | --- |
| Header | logo at left; utility controls at right within wood header | menu/utility at edges, compact centered wordmark |
| Opponent | identity at upper left; 10–11 hidden cards centered across top; score card at upper right | identity and score on one row; compact hidden fan to its right or immediately below |
| Public piles | stock and discard centered, side by side; prompt adjacent | centered pair below opponent; count/labels below each pile |
| Turn/status | compact panel near piles/actions | full-width compact panel below piles |
| Player | identity at lower left; 10–11 face-up cards span the near edge; card count and saved-order status nearby | identity/score above hand; enlarged shallow fan/overlap within full width; concise drag-to-organize guidance beside card count |
| Actions | one or two contextual controls beside the player hand | sticky 60–70px bottom bar with one or two contextual controls and safe-area padding |

The player hand owns the largest clear area. Keep cards in rank order or the user’s explicit order; overlap only enough to fit while leaving the upper-left rank and suit of every card visible. At 375px, distribute a 10-card hand across the available width with hand-size-aware overlap and a modest fan (maximum 7 degrees across the whole hand), not tiny cards. An 11th card may overlap more but remains individually selectable. A selected or keyboard-focused card lifts above its neighbors so its complete face and selection outline are visible. Do not use horizontal scrolling for a normal hand. Reflow before reducing card size.

Desktop may use `position: relative` for the table composition, but interactive areas must remain in DOM reading order: opponent/status, public piles, player hand, player controls. Mobile uses normal flow. Do not make essential actions depend on a decorative table boundary.

## Components

| Component | Responsibility and visual rules |
| --- | --- |
| `GameTable` | Hosts the authoritative projected state, responsive table layout, connection status, and modal layer. Announces phase/turn changes; does not infer legality client-side. |
| `OpponentArea` | Shows display name, dealer/current-turn text, match score, connection marker, and hidden-card count. Render card backs only—never identities—until a result legitimately reveals them. |
| `PlayerArea` | Shows “You”, match score, dealer/current-turn label, `CardHand`, card count, and saved-order guidance. It is visually dominant. |
| `Card` | Semantic button when selectable; otherwise an article/image-equivalent with accessible rank/suit name. Face uses cream, black/red pips, corner indices, and a high-contrast back. Selected cards lift 8px and receive gold outline; forbidden cards state why in text/accessible description. |
| `CardHand` | Maintains a local, non-authoritative per-game display order that survives refresh and remembers encountered card identities across later deals. Supports selection, a shallow fan, pointer/touch drag, arrow-key navigation, and Shift+Arrow reorder. Server-projected meld candidates are labeled only when their cards are contiguous in that private order. |
| `StockPile` | Face-down stack, remaining count, and “Draw stock” control. It is enabled only when the current projection permits the action. |
| `DiscardPile` | Top public card, label, and “Take discard” control. The card itself may activate the same action. |
| `TurnPrompt` | Plain-language current phase: “Your turn — draw a card”, “Choose a card to discard”, “James is choosing a card”, or opening-pass instruction. Pair colored dot with text and `aria-live` announcement. |
| `ScoreBadge` | Compact per-player match score; optional hand number and target in an adjacent score panel. Use numerals plus labels, never gold/position alone. |
| `GameActions` | Contextual action group: opening pass/take, legal draw sources, selection guidance, discard confirmation, and an eligible knock or gin declaration. It preserves its controls in a disabled busy state but does not reserve space for actions irrelevant to the current phase. |
| `WaitingRoom` | Replaces play with invite URL, code, Copy controls, `aria-live` waiting status, and safe refresh reassurance. It never displays a deck or hand. |
| `HandResult` | Focus-trapped centered dialog on desktop and near-full-height bottom sheet on mobile that freezes gameplay. Shows declaration/cancelled-hand outcome, both optimized melds, original and final deadwood, valid layoffs, score formula, updated totals, and each player’s acknowledgement. A cancelled hand explicitly says cards were not revealed and no points were awarded. |
| `GameResult` | Final modal with winner, final scores, completed-hand summary, and rematch request/accept/decline state. No game-play controls remain active. |

## Interaction and state guidance

All user actions send an intent with the current version and idempotency key. The UI waits for the returned safe projection before committing a card movement, score, or state change; a brief pending state is acceptable. On stale/failed action, restore the server projection and place a concise error near the affected controls.

| Moment | UX behavior |
| --- | --- |
| Deal / next deal | Deal only after the server starts the hand (or both acknowledgements). Briefly animate backs outward then reveal only the local hand; announce hand number and whose decision it is. With reduced motion, update immediately. |
| Opening up-card decision | Show the public up-card and clear “Take discard” / “Pass” options for the eligible player. Explain that stock draw follows two passes; never offer an illegal choice. |
| Draw stock | Enable stock only on a legal draw. On acceptance, add the new card to the player hand and switch prompt to discard; do not reveal stock order or animate a visible face from the pile. |
| Take discard | Make the visible top discard and its labeled control activate the intent. On acceptance, move that known card into the player hand, mark it “cannot discard this turn,” and request a discard. |
| Select / discard | In discard phase, card selection lifts and gets a gold outline; show a clear `Discard [rank and suit]` confirmation rather than discarding on first tap. Disable the just-taken discard and describe the restriction. After acceptance, move only the chosen card to the public pile. |
| Reorder | During the local player’s active phase, horizontal pointer/touch drag reorders cards after a movement threshold; Shift+Arrow provides the keyboard equivalent. Persist the private preference locally, retain absent card identities for later deals, and append unseen cards in server order. Reordering never sends a game action or changes scoring. |
| Meld organization | The server projects every rule-valid candidate from the caller’s own hand. Highlight only candidates whose cards are adjacent in the private display order, collapse contained same-kind subgroups to the longest label, and retain genuine Run/Set overlaps. Labels are cosmetic and never replace server discard, knock, gin, or deadwood decisions. |
| Knock / gin | After card selection, show Knock with the server-projected post-discard deadwood count or Gin only when that declaration is legal for the selected discard. Keep ordinary discard available so the player may decline to declare. |
| Opponent action | Retain the player’s view and show a concise status (“James drew from stock”, “James is choosing a discard”, “Your turn”). Do not animate or expose an opponent stock-drawn card. |
| Hand reveal / scoring | On server transition to hand complete, disable table controls, then open `HandResult`. Reveal cards only in the scored hand result and label melds, layoffs, deadwood, calculation, and updated score. |
| Next hand | Each participant uses `Start next hand` / `Ready for next hand`. Show “Waiting for James” after local acknowledgement; deal only after both acknowledge. |
| Match completion | Replace hand continuation with `GameResult`; show rematch request status and link to the new match only after mutual acceptance. |
| Reconnect / disconnected | On local loss, retain the last table view under a non-authoritative “Reconnecting—actions are unavailable” banner and disable all game intents. Fetch the fresh projection before reenabling. For an offline opponent, show their status and disable actions only when the server says their absence prevents it; never forfeit automatically. |

## Motion, accessibility, and keyboard use

- Meet WCAG 2.2 AA contrast. Text, icon, outline, and labels communicate suit, selection, turn, connection, and errors in addition to color. Use real buttons, labels, headings, and dialogs; decorative card texture is hidden from assistive technology.
- Card buttons have names such as “7 of hearts, position 4 of 11, part of run, selected.” Face-down opponent cards are announced as one grouped “James has 10 cards,” not ten indistinguishable controls. Pile controls name their visible card/count and action.
- Keyboard order follows the visual/decision order. `Tab` reaches all controls; arrow keys move between cards in a hand; `Space`/`Enter` selects or activates; `Escape` clears a discard selection or closes a dismissible informational dialog. Shift+Arrow reorders during the player’s active phase and announces the new position. Provide visible `:focus-visible` gold/cream focus rings with a 3:1 contrast ratio.
- Trap focus in `HandResult` and `GameResult`, focus their title on open, and return focus to the invoking control when appropriate. Use polite live regions for turn/opponent/connection changes; assertive announcements only for action errors and blocking disconnection. Avoid repeating announcements after a refetch with unchanged state.
- Respect `prefers-reduced-motion`: no dealing, fanning, lifting, modal, or score-count animation; update state immediately. Otherwise keep motion to 150–250ms opacity/transform transitions, never motion needed to understand rules or state.
- Touch targets are at least 44×44px. Every hover affordance (card lift, pile highlight, tooltip) has an always-available tap, focus, or text equivalent. Test at 375px width, 200% zoom, keyboard-only, and screen-reader flows.

## Implementation guardrails

Render only the player-safe server projection: own cards and meld candidates derived from them, public discard, public counts/scores, and cards revealed by a completed hand. Treat local selection, pending state, manual order, meld visibility, and animation as presentation only. Realtime may prompt a refetch, but the fetched canonical projection determines every visible card, phase, score, and enabled action.

## Card Studio

`/card-studio` is a public prototype work surface, linked quietly from the lobby header. It extends the table's dark green felt, warm wood, restrained gold, cream card stock, and serif branding without adopting generic dashboard chrome. The set list and built-in entry establish the global source; the selected set keeps its status, draft version, published revision, rename/archive controls, and 3×4 J/Q/K-by-suit grid visible together.

Draft and published states must be unmistakable in text. Label Active, Draft, and Archived status directly; show the returned draft version and published revision; and state whether unpublished changes exist. Disable operations that conflict with an in-flight request. A failed request leaves the current draft and input intact and places a stable, human-readable error beside the affected create, rename, archive, slot, or activation control.

Activating a custom set or restoring the built-in design requires a modal confirmation stating that all open games and every future game will update. The active set's archive control stays disabled and explains why. Archived sets are read-only and cannot be activated.

### Portrait treatment and cropping

Custom artwork replaces only the central court illustration for J, Q, and K. Rank, suit, red/black treatment, cream stock, both corner indices, selection/turn markers, and accessible card names remain code-rendered. The enlarged portrait window keeps its restrained ornamental gold frame but has no fill or tone layer, so transparent portrait cutouts reveal the cream card stock directly. Opaque JPEG, PNG, and WebP artwork remains supported beneath the same frame. Missing slots and failed image loads expose the built-in court design; image alternative text is empty because the card control supplies the complete accessible name.

The upload dialog is keyboard-operable, traps focus, returns focus on close, and labels its controls. `react-easy-crop` is locked to 2:3 with panning, zoom from 1–3, reset, cancel, preview, and upload actions. The confirmed crop is sent to the server, which owns decoding, orientation, cropping, resizing, encoding, and input validation.

### Responsive and live behavior

At desktop widths the set list sits beside the editing surface. It stacks above the editor on smaller layouts, while the twelve slots retain a compact four-suit grid at 375px. Reflow controls before shrinking text, preserve 44×44px targets, visible focus, logical dialog focus, keyboard-only operation, 200% zoom support, and immediate state changes under reduced motion.

Game pages fetch the active presentation manifest on mount and every five seconds while the document is visible. Polling pauses while hidden and refreshes immediately when visibility returns. A new published revision changes portrait cache keys. Out-of-order responses are ignored; transient network failures preserve the last successful manifest, while missing or broken artwork always falls back to the built-in court card. Completed-hand and match reveals use the same renderer only for cards the player-safe projection already permits the viewer to see.
