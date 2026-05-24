# Feature Landscape — Crash Game

**Domain:** Multiplayer real-time Crash (casino) — play-money, single-game, technical-challenge submission
**Researched:** 2026-05-24
**Reference products surveyed:** Bustabit (the original), Stake Originals Crash, Spribe Aviator, BC.Game Crash, Roobet, JetX
**Confidence:** HIGH for table stakes (every product converges on the same baseline); MEDIUM-HIGH for differentiators; HIGH for provably fair and real-time UX patterns

---

## 1. Table Stakes

Every credible crash product ships these. Missing any one of them makes the product feel broken or unfinished, regardless of how good the rest is. The challenge's REQ-DOM/REQ-WS/REQ-FE requirements already enforce most of these — those mappings are in the rightmost column.

| Feature | Description | Complexity | Mapped Req |
|---|---|---|---|
| Single-round lifecycle | One active round at a time: BETTING window → RUNNING (multiplier climbs) → CRASHED → settlement → repeat. State machine never accepts illegal transitions. | Med | REQ-DOM-01, REQ-GAME-02 |
| Betting window with countdown | ~5s pre-round window where bets are accepted; visible countdown bar/number; bets locked when window closes. | Low | REQ-FE-02 |
| Bet amount input + validation | Numeric input with min/max bounds (configurable per server), insufficient-balance check, +/- and quick-pick (1x, 2x, 1/2, max) buttons. | Low | REQ-DOM-02, REQ-FE-02 |
| Manual cashout button | Big, unmistakable button only enabled while the player has an ACTIVE bet in a RUNNING round; click locks current multiplier as payout. | Low | REQ-GAME-01 |
| Multiplier rise animation | Curve/value climbs in real time from 1.00x with exponential growth, rendered at ~60fps. Synchronized across all clients. | High | REQ-FE-02, REQ-WS-02 |
| Crash settlement | Round ends instantly at the predetermined crash point; all still-active bets resolved as LOST; cashed-out bets pay out. | Med | REQ-DOM-01, REQ-GAME-02 |
| Live bet feed | Scrolling list/table of every other player's bet in the current round: username, bet amount, status (pending/active/cashed-out @ Nx / lost). Updates in real time. | Med | REQ-FE-03, REQ-WS-01 |
| Cashout feed | Inline indicator (green highlight, payout amount) on the bet feed entry the moment a player cashes out. | Low | REQ-FE-03 |
| Round history strip | Last 20-50 crash multipliers, color-coded (red < 2x, yellow 2-10x, green > 10x). Clickable to inspect/verify a past round. | Low | REQ-FE-04, REQ-GAME-01 |
| Balance display | Always-visible current balance in header; animates on credit/debit (flash + delta). | Low | REQ-WALL-01, REQ-FE-02 |
| Potential payout indicator | Live display of `bet * current_multiplier` next to the cashout button so the player sees exactly what they'd win right now. | Low | REQ-FE-02 |
| Provably fair seed display | Pre-round: show next round's commitment hash. Post-round: reveal the server seed and prove it hashes to the commitment. | Med | REQ-DOM-04, REQ-FE-05 |
| One-click verification | Click any past round → modal/page shows hash chain, seed, formula, and recomputed crash point matching the recorded one. | Med | REQ-FE-05, REQ-GAME-01 (verify endpoint) |
| Toast/error feedback | Insufficient balance, bet rejected (window closed), network error, reconnecting state — all surfaced as non-blocking toasts. | Low | REQ-FE-06 |
| Disconnect/reconnect handling | If WS drops, client shows "reconnecting"; on reconnect, server pushes current round state so client recovers without refresh. Active bets are NOT cancelled by client disconnect (server is authoritative). | Med | REQ-WS-01 (implicit) |
| Authentication | Login required to bet; unauthenticated users can spectate. Token refresh transparent. | Med | REQ-FE-01 |
| Loading/empty states | Skeleton on first load; "waiting for next round" placeholder if user joins mid-round. | Low | REQ-FE-06 |

**Implication for roadmap:** the entire table-stakes set must land in the first vertical-slice phase (login → bet → watch → cashout → see history → verify) before any differentiator is touched. Cutting any of these reads as "incomplete submission" to the recruiter, not as deferred scope.

---

## 2. Differentiators

These separate a generic clone from a product that feels deliberate. Each row carries an explicit recommendation for this 5-day challenge given the scoring weights (DDD 25, Code Quality 20, Tests 20, Frontend/UX 15, Provably Fair 10, Git 10).

| Feature | Competitive Value | Complexity | Build it? | Rationale |
|---|---|---|---|---|
| Auto cashout (target multiplier) | Table-stakes in Stake/Aviator/BC.Game — players expect it. "Differentiator" only relative to a barebones MVP. | Low | **Yes** | REQ-BONUS-01 already requires it. Server-side enforcement (not client-side) is the senior signal — earns DDD points. |
| Auto bet (fixed) | Lets players sit back and watch a strategy run. Required to make auto-cashout actually useful. | Low | **Yes** | REQ-BONUS-02. Implement as a client-side scheduler that places bets via the same WS/REST path. |
| Auto bet — Martingale strategy | Doubles bet after loss; classic crash strategy. | Low-Med | **Yes** | REQ-BONUS-02 explicitly lists it. Pair with stop-loss/stop-win or it's irresponsible UX. |
| Auto bet — Fibonacci / Labouchere | Additional strategies on top of Martingale. | Med | **Stretch** | Only if Martingale + fixed land cleanly with tests. Demonstrates breadth but not depth. |
| Stop-loss / stop-win caps | Auto-bet stops when cumulative profit/loss crosses threshold. | Low | **Yes** | REQ-BONUS-02 requires it; protects player UX and proves the candidate thinks about state machines beyond the happy path. |
| Multi-bet (two simultaneous bets) | Defining feature of Aviator — risk layering. Conservative + aggressive in same round. | Med-High | **Stretch** | Strong differentiator but requires extending Bet aggregate (REQ-DOM-02 currently says single-bet-per-round). Score impact: nice frontend story, but conflicts with current invariant. **If chosen, must update REQ-DOM-02 explicitly.** |
| Leaderboard (24h / weekly profit) | Social proof, retention. Requires read-model projection from settled bets. | Med | **Yes** | REQ-BONUS-05. Excellent DDD signal — implement as event-sourced projection consuming wallet/game events. Naturally demonstrates Outbox pattern's value. |
| Deterministic replay of past rounds | Reproduce any round byte-for-byte from its seed; visual playback with the original multiplier curve. | Med | **Yes** | REQ-BONUS-04. Pairs beautifully with provably fair UX — recruiter sees end-to-end determinism, not just a hash check. Reuses the curve renderer. |
| Live chat | Community signal in real products (Aviator, Stake). | Med-High | **No** | Scope creep with no scoring weight. Moderation/spam handling is a rabbit hole. Out of scope. |
| Sound design | Tick on multiplier, whoosh on takeoff, sharp impact on crash, cha-ching on cashout. | Low | **Yes (cheap polish)** | Tiny effort, big perceived-quality boost during arguição demo. Use 4-5 short royalty-free SFX with a mute toggle. |
| Haptic feedback (mobile) | Vibration on crash/cashout via Vibration API. | Low | **Yes (cheap polish)** | One-line `navigator.vibrate()` calls. Negligible cost, demonstrates responsive thinking. |
| Hot-streak / statistics panel | Rolling stats: "Last 100 rounds avg 2.3x", "Longest streak under 1.5x: 7". | Low | **Yes (free win)** | Derives entirely from the history already required by REQ-FE-04. Zero new server logic. |
| Crash-point distribution chart | Histogram of multipliers from last N rounds. Validates fairness visually. | Low | **Stretch** | Strong fit with provably-fair narrative (10% weight). Quick to build on top of history endpoint. |
| Personal bet history page | Filterable list of the player's own bets with profit/loss totals. | Low | **Yes** | REQ-GAME-01 already exposes `/games/bets/me`. UI for it costs almost nothing. |
| Pre-bet trajectory preview | When player sets an auto-cashout target, show a faint ghost line on the curve where they'd exit. | Low | **Stretch** | Pure visual polish; only worth it if the canvas renderer is already abstracted enough to draw overlays. |
| Crash overlay ("X CRASHED AT 1.42x") | Full-screen flash + freeze on the crash value for ~1.5s before reset. | Low | **Yes** | Standard pattern. Without it, crashes feel anticlimactic. |
| "Cashed out!" win celebration | Particle burst / number flash / sound on personal cashout. | Low | **Yes** | Same justification — emotional payoff drives perceived quality. |
| Server-pushed round result summary | After crash, push `{crashPoint, hashChainLink, yourBet, yourPayout, topWinner}` so each player sees their own outcome highlighted. | Low-Med | **Yes** | Tightens the loop; reuses WS infrastructure. |
| Tournaments / scheduled events | Time-boxed competitions with prize pools. | High | **No** | Massive scope, no scoring weight. Anti-feature for this challenge. |
| Promotions / free bets | Promo codes, welcome bonuses. | Med | **No** | Belongs to a real-money operator, not a technical challenge. |

**Differentiator recommendation summary for this challenge:**
- **Must ship:** auto cashout, auto bet (fixed + Martingale), stop-loss/stop-win, leaderboard, deterministic replay, hot-streak stats, crash overlay, cashout celebration, sound design, haptic feedback. All explicitly listed as bonuses or earned at near-zero cost.
- **Stretch (only if core is rock solid):** Multi-bet (with invariant update), Fibonacci/Labouchere strategies, crash-point distribution chart, pre-bet trajectory preview.
- **Defer/skip:** live chat, tournaments, promotions.

---

## 3. Anti-Features (Deliberately NOT Built)

| Anti-Feature | Why Not | What to Do Instead |
|---|---|---|
| Real money / fiat deposits | Out of scope per challenge spec; would require KYC, PCI, banking integrations. | Play-money wallets seeded with a starting balance (e.g., 1000 credits) on first login. |
| KYC / identity verification | Same as above; zero scoring weight. | Skip entirely. Keycloak handles auth, that's enough. |
| Crypto wallet integration | Tempting given the genre, but adds zero scoring weight and a large surface area. | Mention in README as "production extension point." |
| Native mobile apps (iOS/Android) | Out of scope; spec says responsive web only. | Build mobile-first responsive layout — covers it. |
| Multi-game (dice, plinko, mines) | Spec restricts to Crash only. | Architect cleanly enough that adding one would be a phase, but don't ship it. |
| Live chat | Out of scope, moderation rabbit hole, no scoring weight. | Live bet feed already covers the "I'm not alone" signal. |
| Tournaments / scheduled events | High complexity, no scoring weight. | Leaderboards cover competitive intent. |
| Admin panel | Not requested, would balloon scope. | Use SQL/RabbitMQ Management UI for any operator-style needs during demo. |
| Promotions, welcome bonuses, loyalty tiers | Operator features; no engineering signal. | Out. |
| i18n / multi-language | Spec is neutral; English-only is acceptable. | English UI; PT-BR allowed in commit messages/ADRs per global rules. |
| Customizable client seeds | Adds verification UX complexity; the chained-server-seed model is already provably fair without it. | Skip; document the choice in an ADR. |
| Social/share buttons | No scoring weight. | Skip. |
| Friend lists / private rooms | Out of scope. | Skip. |
| In-game currency shop / cosmetics | Trivial-feeling, dilutes the senior signal. | Skip. |

---

## 4. Real-Time UX Patterns

These are the patterns that distinguish a crash UI that *feels* alive from one that feels like a polled dashboard. Implementation notes are aimed at TanStack Start + Canvas + the existing NestJS WS gateway.

### 4.1 Multiplier curve rendering — **Canvas 2D, not SVG, not WebGL**

A crash curve is a single growing path with ~1-2 visible data points per frame. SVG would re-layout the DOM every tick (degrades past hundreds of nodes); WebGL is overkill for one polyline and a glow effect. Canvas 2D with `requestAnimationFrame` holds 60fps comfortably for this workload and is universally supported. Confirmed by 2026 performance comparisons: Canvas comfortably handles 1k-3k draws/frame at 60fps on mid-range hardware — a crash curve is well under that ceiling.

**Implementation notes:**
- Single full-bleed `<canvas>` element, ResizeObserver-driven backing-store updates for HiDPI (`devicePixelRatio`).
- Draw order per frame: background grid → curve path (filled gradient below the line) → multiplier value text → plane/rocket sprite at the curve's leading edge → cashout markers (player's own + recent others as floating chips).
- Use `requestAnimationFrame` for the render loop; never `setInterval`. Pause when tab is hidden (`document.visibilityState`).
- Curve points stored in a ring buffer of (t, multiplier) tuples; on each frame, walk the buffer and trace the path. Don't store every frame — sample every N ms and let the renderer interpolate between samples.

### 4.2 Synchronization strategy — **Server-authoritative + client-side interpolation**

The server publishes `roundStartedAt` (epoch ms) and the deterministic crash point. Clients compute the current multiplier locally from `(now - roundStartedAt)` using the same growth formula. The server periodically (~5-10 Hz) pushes authoritative `{t, multiplier}` heartbeats so the client can correct drift. **Never trust client time for cashout.** Cashout requests carry the round ID; the server records the multiplier *at the moment the request was received by the WS gateway*, not whatever the client claims.

**Why this beats per-frame server ticks:**
- Network jitter would cause visual stuttering if the curve depended on every WS packet.
- Server only needs to send heartbeats (~10/s × N players) instead of frame-pumps (60/s × N players).
- Each client renders at 60fps locally with negligible CPU.

**Reconciliation rule:** if client-computed multiplier and server heartbeat diverge by > some epsilon (e.g., 0.02), smoothly tween (one or two frames) toward the server value. Don't snap — snapping looks like a bug.

**Growth formula:** the industry-standard is `multiplier(t) = floor(100 * e^(k*t)) / 100`, where `k` is a constant tuning growth speed (Bustabit historically ~0.00006/ms; Aviator similar). Reference: documented exponential `M(t) = e^(k·t)`. Decide `k` empirically so that the curve reaches ~2x in ~5s — feels responsive without being frantic.

### 4.3 Crash visual — **flash + freeze + overlay**

When the server emits `roundCrashed`:
1. **Instantaneous freeze** of the curve at the crash multiplier (stop the rAF update loop).
2. **Red flash** overlay on the canvas (alpha-fade from 0.4 to 0 over ~500ms).
3. **Large "CRASHED @ 1.42x"** typography fading in for ~1.5s.
4. Active (non-cashed) bets in the feed turn red with a "−" indicator.
5. Auto-reset to "waiting for next round" placeholder after the freeze.

Without this sequence, crashes feel like the page broke. The freeze + flash is the emotional punchline.

### 4.4 Cashout feedback — **personal + social**

When the player themselves cashes out:
- Big number flash (e.g., "+125.00 @ 2.50x") centered on the canvas, scaling up and fading.
- Short success SFX (cha-ching/coin).
- Optional vibration pulse on mobile.
- The bet feed entry for the player turns green and pops to the top of a "recent cashouts" rail.

When another player cashes out:
- Their feed entry turns green with their payout displayed (`+250.00 @ 2.50x`).
- Subtle chip-clink SFX (volume scales down with frequency to avoid cacophony at peak load — debounce to N/sec).

### 4.5 Potential payout updates — **client-computed, no extra messages**

`potentialPayout = betAmount * currentMultiplier`. Already locally available. Update inside the same rAF callback that draws the curve. Display next to the (now-armed) cashout button. No server round-trips needed.

### 4.6 Bet feed pattern — **virtualized list, push-driven**

Single scrolling list of all bets for the active round. Use a virtualized list (e.g., `@tanstack/react-virtual`) — at peak load you might have 200-500 concurrent bets and a non-virtualized list will jank. Each row: avatar/initial circle, username, bet amount, status icon, cashout multiplier (when applicable). Status transitions animate with a small color shift, never a layout shift.

### 4.7 Joining mid-round — **server pushes snapshot on connect**

When a client opens a WS, the gateway immediately pushes `{roundId, phase, startedAt, currentMultiplier (server-side), bets[], yourActiveBet}`. The client starts rendering from that snapshot. No "wait for the next round" lock unless the player has no active bet AND the round is RUNNING (in which case they spectate until BETTING reopens).

### 4.8 History strip clickability

Each chip in the recent-history strip is clickable → opens a side panel or modal with: full crash multiplier, server seed, prior hash, formula, recomputed value (live in JS), and a "Replay" button (if REQ-BONUS-04 is built).

---

## 5. Provably Fair UX Patterns

The challenge weights this at 10% and explicitly requires hash-chain commitment + client-side verification (REQ-DOM-04, REQ-FE-05). The UX matters as much as the math here — recruiters score on whether a non-developer player could feel confidence.

### 5.1 Pre-round commitment

- A persistent UI badge ("Fairness ✔ — Next round hash: `8f3c…a921`") visible above or beside the curve.
- Tooltip on hover: "This hash commits the next round's outcome. The server cannot change it once published."
- The badge is always present, not buried in a menu.

### 5.2 Post-round reveal

When a round crashes:
- The badge updates to show: previous hash → revealed seed → crash point.
- One-click "Verify this round" expands an inline panel with:
  - Server seed (revealed)
  - `SHA-256(seed)` recomputed in the browser, side-by-side with the committed hash → match indicator (green checkmark).
  - Crash point formula: `crashPoint = floor((99 / (1 - X)) * 100) / 100` (or the chosen variant), with `X` derived from the seed.
  - The recomputed crash point shown next to the recorded one → match indicator.

### 5.3 Verification page

A dedicated `/verify` route where users can paste any historical (round ID *or* seed) and:
1. Compute the hash chain back as many steps as desired.
2. Show each step's `SHA-256(seed_n) == hash_{n-1}` check.
3. Recompute the crash point from each seed and display alongside the recorded one.

All computation client-side using SubtleCrypto (`crypto.subtle.digest('SHA-256', …)`) — no server trust required. This is the single strongest provably-fair signal: the user can run verification offline.

### 5.4 Hash chain explainer

A small "How does this work?" link opening a clear, plain-English modal:
> "Before the server started, it generated a long chain of secret seeds. The hash of the last seed was published publicly. After each round, the previous seed is revealed. You can hash the revealed seed yourself and check it matches what was published — this proves the server didn't change the outcome after seeing your bets."

Plus a tiny diagram showing `seed_N → SHA-256 → hash_N` and the reverse traversal.

### 5.5 Reference: Bustabit-style algorithm

- Operator generates a chain of length N at startup: `seed_0 = random; seed_{i+1} = SHA-256(seed_i)`. The terminal hash `seed_N` is committed publicly (e.g., in the README and a public endpoint).
- Rounds consume seeds in reverse order (`seed_N` revealed for round 1, `seed_{N-1}` for round 2, …). Each revealed seed is provably the preimage of the next-shown commitment.
- Crash point per round: take `seed_i`, compute `HMAC-SHA-256(seed_i, salt)` (the salt is a public string committed at chain creation, e.g., a Bitcoin block hash from the announcement date), take the first 52 bits as integer `H`, then:
  - With probability 1/100 → crash = 1.00x (house edge)
  - Otherwise → `crashPoint = max(1, floor((100 * 2^52) / (2^52 - H)) / 100)` (yields a ~99% RTP curve)
- Variant verified against multiple 2026 references; exact formula goes in an ADR.

---

## 6. Feature Dependency Graph

The roadmap should respect these edges. Earlier features unlock later ones; building out of order forces rework.

```
[Auth (Keycloak/OIDC)]  ← REQ-FE-01
        │
        ▼
[Wallet domain + REST]  ← REQ-WALL-01, REQ-DOM-03
        │
        ▼
[Round lifecycle + crash point algo]  ← REQ-DOM-01, REQ-DOM-04, REQ-GAME-02
        │
        ├──────────────────────────────┐
        ▼                              ▼
[Bet aggregate + Saga]            [WS gateway + round state push]  ← REQ-WS-01
  ← REQ-DOM-02, REQ-GAME-03/04          │
        │                              │
        └──────────┬───────────────────┘
                   ▼
        [Vertical slice: bet → watch → cashout]
                   │
        ┌──────────┼────────────────────────────────┐
        ▼          ▼                                ▼
[History UI]  [Provably fair UI]                [Live bet feed]
  ← REQ-FE-04  ← REQ-FE-05                       ← REQ-FE-03
        │          │                                │
        │          ▼                                │
        │  [Deterministic replay]                   │
        │   ← REQ-BONUS-04                          │
        │                                           │
        ▼                                           ▼
[Stats panel]                               [Leaderboard projection]
  (free win from history)                    ← REQ-BONUS-05
                                                    │
                                                    ▼
                              [Auto cashout]  ←  REQ-BONUS-01
                                    │
                                    ▼
                              [Auto bet (fixed)]  ←  REQ-BONUS-02
                                    │
                                    ▼
                              [Strategies: Martingale]
                                    │
                                    ▼
                              [Stop-loss / stop-win]
                                    │
                                    ▼
                              [(Stretch) Fibonacci, multi-bet]

Cross-cutting (parallel tracks throughout):
  [Sound + haptics]  →  small, anywhere
  [Observability — OTel, Prometheus, Grafana]  ← REQ-BONUS-03
  [Outbox pattern]  ← REQ-WALL-03  (must land with Bet/Wallet saga)
  [Playwright E2E]  ← REQ-BONUS-06  (after vertical slice)
  [CI]  ← REQ-BONUS-07  (after first green test)
  [ADRs + README]  ← REQ-DOC-01/02 (per decision, throughout)
```

### Suggested phase ordering (input for roadmapper)

1. **Foundation:** Auth, Wallet domain + REST, Outbox/Inbox skeleton.
2. **Game core:** Round lifecycle, provably-fair algorithm + ADR, autonomous round loop (no WS yet — test via fixtures).
3. **Saga + bet flow:** Bet aggregate, BetPlaced/CashOutRequested sagas, idempotency.
4. **Real-time:** WS gateway, server snapshot on connect, heartbeat + reconciliation strategy.
5. **Vertical slice frontend:** Login → bet → curve → cashout → history. Canvas renderer, basic UI, dark casino theme. Locks down the table-stakes set.
6. **Provably fair UX:** Pre-round badge, post-round reveal, /verify page. (10% scoring weight earned here.)
7. **Auto features:** Auto-cashout (server-enforced), auto-bet, Martingale, stop-loss/stop-win.
8. **Differentiator wave:** Leaderboard projection, deterministic replay, stats panel, sound + haptics, crash overlay polish.
9. **Quality hardening:** Property tests, E2E (Playwright), observability, CI badges, ADR catalogue, README.
10. **(Stretch only):** Multi-bet, Fibonacci/Labouchere, distribution chart, trajectory preview.

Phases 6-9 can partially parallelize once 1-5 land.

---

## 7. Sources

All findings cross-referenced across multiple sources; confidence levels noted in summary above.

- [Crash Game Features Explained | Auto Cash Out & Multipliers](https://casinocrashgames.com/features/) — MEDIUM
- [Aviator Casino Game Development - Cost & Key Features](https://www.octalsoftware.com/blog/aviator-game-development) — MEDIUM
- [Mostbet Aviator How to Play (dual-bet pattern reference)](https://guidebook.mostbet.com/aviator/) — MEDIUM
- [Crash Game Mechanics: How Aviator Really Works](https://www.achisoch.com/crash-game-mechanics-how-aviator-really-works-in-live-play.html) — MEDIUM
- [Stake.com Crash game page (live leaderboard, dual mode, dark theme)](https://stake.com/casino/games/crash) — HIGH (primary source)
- [Stake Crash Guide 2026 (UI breakdown)](https://www.sportsgambler.com/review/stake/crash/) — MEDIUM
- [Provably Fair Crash Games: How to Verify Every Round (2026)](https://crashgamesplay.com/guides/provably-fair-explained/) — MEDIUM
- [Crash Game Algorithm: Crash Point Formulas & Hash Math (2026)](https://crashgamesplay.com/guides/crash-game-algorithm/) — MEDIUM
- [How Aviator (Spribe) Provably Fair Algorithm Works](https://gamblingcalc.com/gambling-guides/aviator-provably-fair-algorithm/) — MEDIUM
- [Bustabit Review — The Original Crash Game (99% RTP, Provably Fair)](https://crashgamesplay.com/games/bustabit-review/) — HIGH
- [Official Bustabit GitHub](https://github.com/bustabit) — HIGH (canonical reference implementation)
- [Bustabit Script Simulator (algorithm verified by simulation)](https://github.com/AxelConceicao/bustabit-script-simulator) — HIGH
- [Provably Fair Gaming Explained — Redbot (hash-chain mechanics)](https://redbot.gg/provably-fair-details.html) — MEDIUM
- [The Martingale System in Crash Games](https://justgamblers.com/crash-gambling/with-martingale-system/) — MEDIUM
- [Fibonacci Strategy - Casino Crash Games](https://casinocrashgames.com/strategies/fibonacci/) — MEDIUM
- [Fast-Paced Multiplayer (Part III): Entity Interpolation — Gabriel Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html) — HIGH (canonical reference)
- [Build Real Time Multiplayer Game with WebSockets](https://blog.vibecoder.me/build-realtime-multiplayer-game-websockets) — MEDIUM
- [SVG vs Canvas vs WebGL: Performance Comparison 2026](https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025) — MEDIUM
- [Comparing Web Graphics: Canvas, SVG, WebGL, and CSS](https://tapflare.com/articles/web-graphics-comparison-canvas-svg-webgl) — MEDIUM
- [Animation performance and frame rate — MDN](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate) — HIGH
- [Understanding the Mathematical Trajectory of Crash Games](https://exeleonmagazine.com/understanding-the-mathematical-trajectory-of-crash-games/) — MEDIUM
- [JetX Game Animation Style — Review (sound/animation patterns)](https://filey.org/blog/casino/jetx-game-animation-style-review/) — MEDIUM
- [Practice audio haptic design — Apple WWDC21](https://developer.apple.com/videos/play/wwdc2021/10278/) — HIGH (general haptic design principles)

**Notes on confidence:**
- Algorithm specifics (Bustabit formula constants, Aviator's SHA-512-from-3-players quirk) are MEDIUM and should be re-verified before implementation — an ADR locks the chosen variant.
- UX patterns are HIGH because the entire crash-game category converges on the same idioms; deviation reads as inexperience.
- Canvas-over-SVG recommendation is HIGH and aligned with both 2026 benchmarks and the de facto choice in every shipped crash game.
