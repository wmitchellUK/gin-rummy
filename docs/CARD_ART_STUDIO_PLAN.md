# Admin-Managed Face-Card Studio

## Summary

Build a public Card Studio where anyone can create and edit named face-card sets, assign ordinary photos to any of the twelve J/Q/K suit slots, and activate one set globally. All current and future games use the active set, with missing images falling back to the existing court-card design.

Keep rank, suit, cream card stock, selection states, and accessibility labels code-rendered. Only the central court illustration becomes customizable, using the reference's navy mat, restrained gold frame, and portrait treatment.

## Implementation Changes

- Add a “Card Studio” link to the main lobby and a responsive `/card-studio` editor.
- Support named sets with a 3×4 Jack/Queen/King-by-suit grid, upload, crop/zoom, preview, remove, rename, archive, and “Activate for all games.”
- Process uploads into metadata-free 600×900 WebP assets. Accept JPEG, PNG, or WebP up to 10 MB; reject SVGs, invalid files, and undecodable images.
- Keep draft edits separate from the published manifest. Activating a set atomically publishes its current draft, increments its revision, and changes the global active set.
- Do not allow the active set to be archived. Provide the built-in court design as a global reset/default option.
- Render custom art through the existing `CardFace` path for player hands, discard piles, and revealed result cards. Number cards remain unchanged.
- Place portraits inside a clipped central frame with `object-fit: cover`; retain both corner indices above the image and use suit-colored ornamental accents.
- Fetch the active manifest through a small shared client provider. Refresh it every five seconds while a game is visible and cache assets using the published revision as a cache-busting key.
- Keep the pure game engine, canonical game state, legal actions, and player-safe projection unchanged; card art is presentation-only.

## Data and Interfaces

- Add `card_art_sets` with name, draft manifest, published manifest, revision, archive state, and timestamps.
- Add a singleton `card_art_settings` row identifying the globally active set and revision.
- Add a public-read, server-write Supabase Storage bucket for processed card artwork. Use immutable randomized object paths and deny direct browser writes.
- Add a service-role-only transactional function that publishes and activates a set.
- Define `FaceCardRank = "J" | "Q" | "K"`, the four canonical suits, `FaceCardSlot`, and a twelve-slot partial manifest.
- Provide APIs for listing/creating/updating/archiving sets, uploading/removing slot images, reading the active manifest, activating a set, and restoring the built-in default.
- Centralize editor authorization in one server guard. It will intentionally allow all callers initially so later admin authentication can replace the guard without changing routes or UI.
- Return stable error codes for invalid slots, unsupported images, oversized uploads, missing sets, archived sets, active-set deletion, and activation conflicts.

## Test Plan

- Unit-test slot validation, draft/published separation, partial manifests, default fallback, and custom-art selection for J/Q/K only.
- Test upload decoding, resizing, WebP conversion, metadata removal, size limits, and rejection of SVG or malformed files.
- Extend database tests for atomic activation, revision increments, active-set archive protection, Storage write denial, and built-in reset.
- Component-test corner readability, image fallback, red/black suit treatment, cache revision changes, and number-card behavior.
- Add a targeted Playwright flow: open Card Studio, create a set, crop and upload images, activate it, open a game, and verify both players receive the same art.
- Visually verify desktop, 375px mobile, 200% zoom, keyboard-only controls, reduced motion, and revealed-hand rendering.
- Run targeted tests during development, followed by `npm test`, `npm run lint`, and `npm run build`.

## Assumptions

- “Anyone can go to it” includes permission to save and activate global artwork; this is explicitly a prototype security posture.
- Uploaded artwork is intended to be visible to every player, so processed assets may be publicly readable.
- No AI image generation or automatic background removal is included; the editor crops ordinary photos and the renderer supplies the card styling.
- Activating a set updates open games within approximately five seconds without affecting game rules or state.
- Existing uncommitted changes in `app/globals.css` and `docs/UX.md` will be preserved and only touched where necessary.
