# RC2 P2 — Zero-Capital AI Fallback

**STATUS: IMPLEMENTED**

## Purpose

Describes the actual, implemented behavior of the system when the AI
provider is unavailable — whether because no key is configured, or the
provider fails at request time. This document describes what the code
does, not an idealized or aspirational architecture.

## Critical distinction

> Zero-capital mode means the product remains useful without funded AI
> credits. It does NOT mean every AI-dependent feature becomes fully
> available without an LLM. Worksheets, tests, lesson plans, parent
> messages, report comments, intervention plans, and similar generated
> content genuinely require the AI provider — there is no offline
> generator for these, and this work does not add one.

## Architecture

`services/aiService.js` is the sole AI abstraction (Anthropic-primary,
OpenAI-fallback via `detectProvider()`). It is unchanged by this work.
`services/aiAvailability.js` is a new, small, side-effect-free
classification layer on top of it. It makes no network calls, adds no
retries, and does not introduce a second provider or any offline/local
model. It only decides which teacher-facing message a caller should show
for an error `generateContent()`/`generateWithVision()` already threw.

## Behavior by scenario

### AI available
Existing generation path is used exactly as before — no change.

### Missing AI credentials (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` unset)
`detectProvider()` throws `No AI API key found...` as it always has. Every
call site already wrapped `generateContent()` in a catch that rolls back
usage; that part is unchanged. What changes is the message shown to the
teacher: instead of the generic "please try again" (which can never
succeed with no key configured), the teacher receives a truthful message
stating AI generation is unavailable and listing genuinely-available
deterministic capabilities (MENU, NEW TEST, PRINT, MY RESOURCES, CLASS
INTERVENTION). The system never claims generation succeeded, and never
claims every feature works without AI.

### Transient provider failure (timeout, network error, 5xx)
Unchanged. These are classified as worth retrying, so the caller's
existing "please try again" copy is preserved as-is.

### Rate limiting / auth failure (429, 401/403)
Classified as `rate_limited` / `auth_failed`. Neither is treated as
retry-pointless — a later request may succeed once the condition clears
— so the existing transient-failure copy is kept. The system does not
tell a teacher they are "out of credits" unless it actually knows that;
today it does not distinguish quota exhaustion from a generic 429, so it
only ever says "please try again."

### Malformed/unknown provider response
Classified as `malformed_response` / `unknown`. Treated as retry-worthy
(existing copy kept). Never crashes on unexpected error shapes —
`classifyAiError()` tolerates non-Error inputs, strings, `null`, and
`undefined`.

## `AI_DEGRADED` semantics

`getAiStatus()` exposes three statuses: `AI_AVAILABLE`, `AI_UNAVAILABLE`,
`AI_DEGRADED`. `AI_DEGRADED` reflects `utils/aiCostMonitor.js`'s existing
daily call-count ceiling (`isCeilingReached()`). **This is informational
only.** Today, reaching the ceiling does not block `generateContent()`
calls at all — the only place the ceiling changes real behavior is
`services/intentClassifier.js`, which falls back to its regex parser for
intent detection once the ceiling is hit. `aiAvailability.js` does not
use `AI_DEGRADED` to gate or alter generation; it exists for
status/logging visibility, matching the cost monitor's existing design.
No new behavior was added to make this status "do more" than it already
does.

## Deterministic capabilities (already shipped, unaffected by this work)

- Mental Maths: `services/mentalMathsSessionService.js` computes
  questions/answers deterministically; `core/generationPipeline.js`
  already falls back to deterministic rendering when only the AI wording
  call fails and a session exists.
- Intent classification: `utils/intentParser.js` regex fallback, used
  when the AI classifier is down or the cost ceiling is reached.
- Menu-driven flows requiring no AI: class/roster management, mark
  capture and analysis (`NEW TEST`), blueprint printing (`PRINT`),
  saved-resource retrieval (`MY RESOURCES`), class-wide intervention
  overview (`CLASS INTERVENTION`) computed from marks already captured.

## What this work did NOT do

- No second AI provider or offline/local model was added.
- No new retries were introduced anywhere.
- No change to authentication, authorization, quota, or database schema.
- No change to RC2 P1's verified menu routing.
- No secrets, tokens, or provider internals are ever included in a
  teacher-facing message.

## Files touched

- `services/aiAvailability.js` (new)
- `tests/rc2-p2-ai-fallback.test.js` (new)
- `core/generationPipeline.js` (message text only, at existing catch site)
- `flows/interventionPlanFlow.js` (message text only)
- `flows/assessmentAnalysisFlow.js` (message text only)
- `flows/reportCommentFlow.js` (message text only, 3 catch sites)
- `flows/parentMessageFlow.js` (message text only, 3 catch sites)
- `core/commandHandler.js` (message text only, formal-letter catch site)
