# dsh-topic-graph

> Session topic graph — split every conversation into turns, let AI incrementally cluster them into topics and stages, and see where tokens, tools, and time actually went.

[中文](README.md) | **English**

`dsh-topic-graph` is a Web UI plugin for [dsh](https://github.com/deepseek-ai) (DeepSeek Harness). It listens to the dsh session event stream, splits each session into **turns**, then asks DeepSeek to **incrementally** cluster turns into **topics** and topics into **stages**, naming both. **Subagent sessions** spawned by a session are segmented too and drawn as branches in the very same graph.

The plugin renders a draggable, resizable, collapsible floating panel in the bottom-right corner of the Web UI, with two views:

- **Chain**: stage → topic (with subtopics) → turn details;
- **Graph**: a tree of stages / topics / subtopics / subagent branches, with Ctrl+wheel zoom, wheel scrolling, and hover tooltips.

## Screenshots

### Chain view

![Chain view](assets/screenshot-chain.png)

*Stage → topic → turns, with the global stats strip on top (tokens / step time / tools / turns / topics / stages / relations).*

### Expanded topic

![Expanded topic](assets/screenshot-chain-expanded.png)

*Expand a topic to see token share and input/output breakdown, tool distribution, agent time, and per-turn details.*

### Graph view

![Graph view](assets/screenshot-graph.png)

*Stage containers + topic tree + subagent branch boxes on the right; subagent topics are drawn inline, hover for details, Ctrl+wheel to zoom.*

---

## Why

The hardest question in a long session is "where does this stand, where did the time go, and where was that conclusion?" Chat history is linear; actual work is a graph. This plugin folds a linear session into a navigable work map:

- Per-turn stats: **tokens (input / output / cache read / cache write), tool calls, agent time**;
- AI clusters turns into topics and topics into stages, and detects relations such as depends-on / continues / contrasts / fixes / verifies / **revisits**;
- Subagents are no longer hidden in another session: they appear as branches under the parent topic, with comparable tokens and time;
- Open any topic's detail and jump straight back to its first turn in the conversation.

## Features

### Segmentation & stats

- **Turn-based**: one turn = `turn/start` ~ `turn/end`; stores user input, assistant reply, token usage, tool calls (counts / distribution / errors), turn duration (sum of per-turn durations, not last-minus-first), and step active time.
- **AI topics & stages**: DeepSeek groups consecutive turns into a work thread (topic) and adjacent topics into a stage, with names and summaries.
- **Subtopics up to 3 levels**: AI decides whether a subtopic is worth creating (e.g. a submodule, a dedicated bug hunt); depth is hard-capped at 3 (root = level 1), deeper nodes are flattened by the Host.
- **Incremental segmentation**: when new turns arrive, only the new turn summaries + the existing topic/stage structure are sent; historical turn bodies are never re-sent. Long sessions are imported in batches, showing results as they are produced.
- **Long-session / 400 resilience**: 6 turns per request by default; a failed request halves the batch (6→3→1) and remembers a working batch size; 400-class errors retry once with the adapter's default reasoning effort; the output cap scales with topic count, truncated structure JSON is retried with a larger cap and detected so a half structure is never applied; after repeated failures it degrades to local fallback instead of burning tokens.
- **Shares**: every topic / stage / turn shows token share, tool-call share, and agent-time share; the top strip shows totals (turns, topics, stages, tokens, tools, step time, wall time, relations, subagent tokens).

### Graph & relations

- **Typed edges**:
  - `next` — chronological chain between adjacent root topics;
  - `belongTo` — topic belongs to a stage / subtopic belongs to its parent / subagent topic belongs to its branch;
  - `has_relation` — AI-judged semantic relation (depends-on / continues / contrasts / fixes / verifies / revisits…), with a label;
  - `delegates` — parent topic → subagent branch.
- **Title-only relation pass**: after segmentation, a cheap analysis over **topic titles only** detects links and especially the **A → B → A revisit** pattern; configurable via `relationMode` (`titles` / `inline` / `off`).
- **Subagents in the same graph**: subagent sessions are segmented automatically and rendered as a branch box with their own topic tree; click the branch header to open that subagent session, click a child topic for its detail. Nested delegation (subagent of a subagent) is supported too.

### UX

- **Follows the sidebar**: reads the shell-persisted current-session selection (`dsh.sessions.current`), so switching workspace/session on the left updates the graph automatically; the panel dropdown can pin a session, and a pinned subagent session survives left-side switches.
- **Topic detail**: ⓘ on a chain card or a click on a graph node opens a detail overlay (token breakdown, tool distribution, durations, relations, parent/children, subagent branches).
- **Jump to first turn**: the detail footer's “Open first turn in chat” switches to the session and tries to scroll to the topic's first turn (falls back to opening the session when history is not fully loaded).
- **Graph controls**: Ctrl+wheel zooms around the cursor, plain wheel scrolls, hover shows a full tooltip, click opens details.
- **Floating panel**: ~900px wide by default, resizable up to nearly the viewport width; when collapsed into a pill it can still be dragged, and a tap expands it.
- **Theme & locale**: only `--dsw-alias-*` theme tokens (light/dark aware); all visible text goes through the dsh locale service (Chinese / English).

### Engineering

- **No build step**: the Client half is plain React + `h()` with React provided by the dsh runtime; refresh the page after editing. Host changes need a dsh restart.
- **The log is the source of truth**: turn stats are rebuilt from the session log (`ctx.sessionQuery.readSession`), live sessions are folded incrementally from `session/event` and deduped by `seq`; AI only decides the structure.
- **Lightweight persistence**: only topics/stages/relations plus "segmented through turn" are persisted to `<DSH_HOME>/data/topic-graph/<sessionId>.json` (atomic, debounced); restored on restart and segmentation continues.

## Install

Requires a working dsh Web profile.

```bash
# 1) clone
git clone https://github.com/hagen666/dsh-topic-graph.git
cd dsh-topic-graph

# 2) install into the dsh web profile (use your absolute path)
dsh plugin --profile web add file:/absolute/path/to/dsh-topic-graph
```

Then **restart dsh** (Ctrl-C in the terminal running `dsh web`, start it again) and refresh the browser page.

> The plugin registers Host rows via `dsh.bundle.patch` and declares the Web client via `dsh.client`; no extra build is needed — `lib/client.js` is the browser bundle.

## Configuration

Configure under `config` in `cordis.patch.yml` (or override in your profile patch layer):

| Key | Meaning | Default |
| --- | --- | --- |
| `segmentMode` | `auto` (AI first, rule fallback) / `llm` (AI only) / `rule` (rules only, zero cost) | `auto` |
| `provider` / `model` | Model route for segmentation; auto-detected when empty | `deepseek-official` / `deepseek-flash` |
| `batchTurns` | Turns per model request (halved automatically on failures) | `6` |
| `maxInputChars` | Character cap for new-turn summaries per request | `8000` |
| `debounceMs` | Debounce after a turn ends before segmenting (ms) | `2500` |
| `minGapMs` | Minimum gap between two AI segmentations of one session (ms) | `8000` |
| `autoSegment` | Incrementally segment automatically when new turns arrive | `true` |
| `showSubagents` | Show subagent sessions in the session list (branches are always included) | `false` |
| `includeSubagents` | Include subagent sessions in segmentation and branches | `true` |
| `maxSubagentDepth` | Max recursion depth of subagent branches (1–5) | `2` |
| `maxBranches` | Max branches returned per graph request (1–60) | `20` |
| `relationMode` | Relation detection: `titles` (title-only, default) / `inline` (from segmentation) / `off` | `titles` |
| `reasoningEffort` | Reasoning effort for segmentation `off/low/high/max`; retried with default on 400 | `off` |
| `ruleTurnsPerTopic` | Turns per topic in rule mode | `3` |
| `ruleTopicsPerStage` | Topics per stage in rule mode | `5` |

## Usage

- **Chain tab**: stage card → topic card (expandable to turn details); click a turn row to see token breakdown, tool distribution, model, input/reply previews; topics show related-topic chips and subagent groups.
- **Graph tab**: stage containers + topic/subtopic tree + subagent branches on the right; Ctrl+wheel zoom, wheel scroll, hover for full info, click a topic for details.
- **Topic detail**: token breakdown/shares, tool distribution, step time, relations, parent/children/subtopics/subagent branches; footer button jumps to the first turn.
- **Subagents**: click a branch header to open that subagent session; click a child topic for its detail; the detail view can navigate back to the parent session.
- **Session picker**: follows the sidebar current session by default; pick a session to pin it, or choose “Follow sidebar session” to resume following.

## How it works

```
session/event ─┐
               ├─► turn fold (turns) ─► incremental AI segmentation ─► topics / stages / relations
readSession  ──┘                                                    └─► subagent branches
                                                                          │
                                          webServer REST ────────────────┴──► /plugins/topic-graph/*
                                                                          │
                                          shell.overlay floating panel (chain / graph)
```

- **Host half** (`lib/index.js`): event folding, turn stats, incremental AI segmentation (prompting / validation / fallback / adaptive batching), relations and subagent branches, persistence, HTTP routes.
- **Client half** (`lib/client.js`): registers `shell.overlay`, polls the Host, renders both views, the detail overlay, and jump actions.
- AI output is validated by the Host: turns must be covered exactly once, parent links must exist and be acyclic, subtopic depth ≤ 3, every topic must belong to a stage; invalid parts are fixed or rolled back, and truncated JSON is repaired where possible.

### HTTP routes

| Route | Meaning |
| --- | --- |
| `GET /plugins/topic-graph/ping` | Health check (returns plugin version) |
| `GET /plugins/topic-graph/sessions` | Session list (title, last activity, whether segmented) |
| `GET /plugins/topic-graph/graph?sessionId=&version=` | Full graph for a session (turn stats + topics + stages + relation edges + subagent branches + AI status); returns `{unchanged:true}` when `version` is unchanged |
| `POST /plugins/topic-graph/segment` | Trigger segmentation `{sessionId, full}`; `full:true` re-segments everything |

### Data & persistence

- Turn stats are not persisted: they are rebuilt from the dsh session log, which is the source of truth.
- The segmentation structure is persisted to `<DSH_HOME>/data/topic-graph/<sessionId>.json` — only topics/stages/relations and "segmented through turn"; restored on restart and extended incrementally.
- New turns (`turn/end`) trigger a debounced background segmentation even while the panel is collapsed.

## Known limitations

- Turns interrupted without a `turn/end` in the log are treated as “running” until dsh's log repair closes them.
- “Open first turn in chat” locates the turn via the chat's `data-chat-turn` DOM marker; it is best-effort — when older history is not loaded it only opens the session.
- Following the sidebar uses the shell's persisted `dsh.sessions.current` key; if dsh changes that implementation, the plugin falls back to the Host's “most recently active session”.
- A subagent's parent topic is inferred from the turn active when the child started (the AI does not re-read child bodies); use “Re-segment all” to regenerate if needed.
- Subagent sessions call the model for their own segmentation; control cost via `includeSubagents`, `maxBranches`, and `minGapMs`.
- Very long sessions produce large graph payloads (hundreds of KB for hundreds of turns); the client skips unchanged polls via `version`. All traffic stays on localhost.

## Development

```bash
# edit lib/client.js: refresh the browser page (no build)
# edit lib/index.js (Host half): restart dsh
```

Layout:

```
lib/index.js      Host: event folding, turn stats, AI segmentation, relations/branches, persistence, REST
lib/client.js     Client: shell.overlay panel (chain / graph / detail / jump)
cordis.patch.yml  dsh bundle registration and default config
locale/           plugin display name and description (zh / en)
assets/           README screenshots
icon.svg          plugin icon
```

## Changelog

- **0.3.2** — Fix `[object Object]` in chain topic token metrics; when structure JSON is truncated, retry with a larger output cap and detect truncation to avoid applying half a structure.
- **0.3.1** — Discover subagent lineage even when `/graph` is requested before `/sessions`; test hooks and version bump.
- **0.3.0** — Inline subagent branches in the main graph, title-only relation analysis (incl. revisits), topic detail with jump-to-first-turn, global stats strip, ≤3-level subtopics, wider panel and draggable collapsed pill.
- **0.2.x** — Title-based relations, AI 400 adaptive splitting and diagnostics, stats strip and depth limit.
- **0.1.0** — First release (turn splitting, incremental AI topics/stages, chain & graph views, subagent branches).

## License

MIT.
