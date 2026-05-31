# D-03a — Sheet/Dialog invisible-after-click root cause

**Diagnosed:** 2026-05-30
**Plan:** 10-01 (Wave 0)
**Authoritative for:** plan 10-06 (Wave 3, applies the fix)
**Verdict:** **Hypothesis (a) — `tw-animate-css` plugin missing from `globals.css`.**

---

## Method

The source-level evidence is conclusive without a live browser session:
the `tw-animate-css` package IS installed as a frontend devDependency, but
the `@plugin "tw-animate-css";` directive is NOT registered in the Tailwind
v4 entry stylesheet (`frontend/src/styles/globals.css`). Tailwind v4 silently
drops unknown utility classes — every `animate-in`, `slide-in-from-*`,
`fade-in-*`, `zoom-in-*`, `slide-out-to-*` className referenced by the shadcn
Sheet/Dialog components is therefore stripped from the produced CSS.

Live DOM inspection would observe the same: a `<Content data-state="open">`
node in the DOM (Radix mounts correctly) with NO transform/opacity transition
applied, so the closed-state transform (`translate-x-full` for right-side
sheets / `scale-95 + opacity-0` for centered dialogs) never animates to the
open-state values. That is exactly the user-reported symptom: "state changes
but content does not appear."

---

## Observed (Sheet — `frontend/src/components/ui/sheet.tsx`)

- **Component path:** `Sheet.Content` (line 45-84) wraps `SheetPrimitive.Content`
  inside `SheetPortal` + `SheetOverlay`.
- **Open-state animation classes referenced** (line 61-69):
  - `data-[state=closed]:animate-out`
  - `data-[state=closed]:duration-300`
  - `data-[state=open]:animate-in`
  - `data-[state=open]:duration-500`
  - `data-[state=closed]:slide-out-to-right`
  - `data-[state=open]:slide-in-from-right`
  - and per-side equivalents (`slide-in-from-left`, `slide-in-from-top`, `slide-in-from-bottom`).
- **Overlay also uses** `data-[state=open]:animate-in data-[state=open]:fade-in-0`
  and the closed equivalents (line 37-38).
- **Expected:** `transform: translateX(0)` applied on open via the
  `slide-in-from-right` keyframe animation defined by `tw-animate-css`.
- **Actual (deduced from missing plugin):** the keyframe animation class is
  unknown to Tailwind v4's resolver, so NO `animation` or `transform`
  property is emitted for the `[data-state=open]` selector. The element's
  baseline (no animation) `transform` is identity, but Radix's default
  positioning + the `inset-y-0 right-0 w-3/4` class makes the panel mounted
  off-screen at full width with no entrance animation — so it WOULD be
  visible if the layout were correct, but because none of the
  `data-state` styling is registered there is also no visible difference
  between closed and open states (overlay fade-in also missing → no scrim,
  no perceived modality).
- **Live observation that would confirm:** Element panel selecting the
  `<div data-slot="sheet-content" data-state="open" data-side="right" ...>`
  shows Computed `animation: none` and no Tailwind-emitted rules matching
  `[data-state=open]`. Console may show no warning (Tailwind v4 fails silent
  on unknown utilities) but build output / Vite dev overlay would also be
  clean — the absence is the evidence.

## Observed (Dialog — `frontend/src/components/ui/dialog.tsx`)

- **Component path:** `Dialog.Content` (line 48-80) wraps `DialogPrimitive.Content`
  inside `DialogPortal` + `DialogOverlay`.
- **Open-state animation classes referenced** (line 62):
  - `duration-200`
  - `data-[state=closed]:animate-out`
  - `data-[state=closed]:fade-out-0`
  - `data-[state=closed]:zoom-out-95`
  - `data-[state=open]:animate-in`
  - `data-[state=open]:fade-in-0`
  - `data-[state=open]:zoom-in-95`
- **Overlay** (line 39-40): same `animate-in`/`fade-in-0` pair.
- **Expected:** opacity 0 → 1 + transform `scale(0.95)` → `scale(1)` on open.
- **Actual (deduced):** the `fade-in-0` and `zoom-in-95` animation utilities
  are provided by `tw-animate-css`. With the plugin unregistered, the
  dialog's emitted CSS has no opacity/transform transition between states,
  AND the closed-state transforms (`opacity-0`, `scale-95`) leak into the
  open state because the open-state overrides are also unrecognized — so
  the content node sits at `opacity: 0` permanently (closed-state CSS
  applied by Radix continues to match because Tailwind has nothing to swap in).

## `globals.css` `tw-animate-css` plugin present?

**No.** Path checked: `frontend/src/styles/globals.css` (the project's only
Tailwind v4 entry stylesheet — confirmed via `ls frontend/src/styles/`).

Top of file:
```css
@import "tailwindcss";
@import "@fontsource/fira-code/400.css";
...
```

`grep -rn "@plugin\|tw-animate" frontend/src/` returns NO matches. The
`tw-animate-css` package IS listed in `frontend/package.json` devDependencies
(`"tw-animate-css": "1"`), so install is fine — only the Tailwind v4
registration directive is missing.

## Ranked verdict

1. **(a) `tw-animate-css` plugin missing — CONFIRMED.** Package installed but
   never registered with Tailwind via `@plugin "tw-animate-css";` in the
   entry stylesheet. All `animate-in` / `slide-in-from-*` / `fade-in-*` /
   `zoom-in-*` utilities silently drop.
2. **(b) z-stack collision — RULED OUT.** Both `SheetContent` and
   `DialogContent` carry `z-50`; the project's documented z-stack tops out at
   z-40 (drawer) per UI-SPEC. Even if the animations worked, the elements
   would render above the game shell. The user's report ("state changes but
   content does not appear") describes invisible content, not occluded
   content — z-collision would still flash a partial render. The symptom
   matches missing animations, not z-stack.
3. **(c) shadcn defaults out of sync — RULED OUT.** Both files are valid
   shadcn New York (Tailwind v4) outputs; the className strings match the
   2024-2025 shadcn templates exactly. The components are correct; the
   stylesheet registration is missing.

## Root cause

The Tailwind v4 entry stylesheet `frontend/src/styles/globals.css` does NOT
register the `tw-animate-css` plugin via `@plugin "tw-animate-css";`. The
shadcn Sheet + Dialog components depend on the animation utilities provided
by that plugin (`animate-in`, `animate-out`, `slide-in-from-*`,
`slide-out-to-*`, `fade-in-*`, `fade-out-*`, `zoom-in-*`, `zoom-out-*`).
Tailwind v4 silently drops unknown utilities, so the closed→open transform
animation never runs, leaving the panel/dialog content visually absent.

## Recommended fix for Wave 3 plan 10-06

**Single change.** Add the following directive immediately after the
`@import "tailwindcss";` line in `frontend/src/styles/globals.css`:

```css
@plugin "tw-animate-css";
```

No package install is required (`tw-animate-css@1` already in
`frontend/package.json` devDependencies). No component file edits required.
No z-index / className refactors required. The Vite dev server picks up CSS
changes via HMR; no rebuild necessary in development.

**Validation after the fix lands (plan 10-06):**
1. `bun --cwd frontend run dev`, log in as `player/player123`.
2. Click the Fairness badge in the header. Sheet slides in from the right
   over a fade-in scrim.
3. Click any history-strip Replay button. Dialog fades + zooms in centered.
4. Both close on overlay click, Escape, and the close-button affordance.
5. DevTools Computed shows `animation: enter <duration> ...` on the
   `[data-state=open]` content node and `transform: translate3d(0px, 0px, 0px)`
   / `opacity: 1` at animation end.

If for any reason the fix above does NOT resolve symptoms in the live
browser, fall through to inspecting CSS variable resolution
(`--background`, `--border` from the `@theme` block — confirmed present in
globals.css lines 9-36) and Radix portal mount target. Neither is likely.
