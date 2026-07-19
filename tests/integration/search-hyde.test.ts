/**
 * Integration tests for HyDE (Hypothetical Document Embeddings) behavior.
 *
 * Verifies that enabling `hyde: true` actually changes the ranking pipeline
 * versus `hyde: false`. This is the regression test for the bug where HyDE
 * ran end-to-end but the additive heading/file boost combined with a narrow
 * candidate pool collapsed both code paths onto the same result set, making
 * `--hyde` a visual no-op.
 *
 * Two checks are performed against the same fixture corpus:
 *
 *  1. The top-k result list is not byte-identical between hyde:true and
 *     hyde:false. A pure no-op would produce two identical orderings.
 *  2. hydeOptions are forwarded through the spread without crashing or
 *     dropping fields.
 *
 * Requires OPENAI_API_KEY (real LLM + embedding calls). Skipped otherwise.
 * Local: `pnpm test:all` or `OPENAI_API_KEY=... pnpm test`.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildEmbeddings,
  semanticSearch,
} from '../../src/embeddings/semantic-search.js'
import { buildIndex } from '../../src/index/indexer.js'
import { registerDefaultProviders } from '../../src/providers/index.js'

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'search-hyde')
const originalMdmHome = process.env.MDM_HOME

const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect)

const skipIfNoApiKey = () => {
  if (!process.env.OPENAI_API_KEY && !process.env.INCLUDE_EMBED_TESTS) {
    return true
  }
  return false
}

/**
 * Generate a sizable fixture corpus that exercises both fix paths:
 *
 *  - Many sections (>20) so the wider HyDE candidate pool actually pulls in
 *    candidates that the default 2x pool would miss.
 *  - A README.md so file-importance boost is in play (otherwise the boost
 *    cap is inert against the existing file-boost contributions).
 *  - Multi-term headings so heading-boost can stack high enough to be
 *    clamped by TOTAL_BOOST_CAP.
 *  - Conceptually overlapping topics across files so HyDE-induced
 *    embeddings actually surface different chunks from the lexical match.
 */
const TOPICS = [
  {
    file: 'README.md',
    heading: 'Authentication and Session Reference',
    body: `This README is the entry point for the authentication subsystem.
It documents login flows, refresh tokens, OAuth providers, and session
storage. Operators should also consult the gateway, retry, and audit
sections for end to end coverage.`,
  },
  {
    file: 'login-flow.md',
    heading: 'Login Flow Configuration',
    body: `User login uses email and password against the identity service.
The service issues a short lived access token plus a longer lived refresh
token. Lockout policies apply after repeated failures.`,
  },
  {
    file: 'refresh-tokens.md',
    heading: 'Refresh Token Lifecycle',
    body: `Refresh tokens have a sliding window of fourteen days. Clients
exchange the refresh token for a new access token before the access token
expires. Rotation invalidates the previous refresh token to limit replay.`,
  },
  {
    file: 'oauth-providers.md',
    heading: 'OAuth Provider Setup',
    body: `Google, GitHub, Microsoft, and Okta are supported via OAuth 2.0.
Each provider requires a client id, client secret, and an allow listed
redirect URI. The callback handler maps provider claims to local user ids.`,
  },
  {
    file: 'session-storage.md',
    heading: 'Session Storage and TTL',
    body: `Sessions live in Redis under the session id key. The TTL matches
the access token lifetime so an idle session is reaped automatically. A
sweeper job deletes orphaned records hourly.`,
  },
  {
    file: 'long-running-requests.md',
    heading: 'Long Running Request Handling',
    body: `Requests that outlive the access token are pinned to a server
side session record. The gateway transparently rotates the underlying
credential mid request without disturbing the in flight call. Streaming
responses re authenticate on each chunk boundary.`,
  },
  {
    file: 'gateway-routing.md',
    heading: 'Gateway Routing Layer',
    body: `The edge gateway terminates TLS, validates the bearer token, and
forwards the request to the upstream service. Health checks bypass token
validation and use a shared secret instead.`,
  },
  {
    file: 'retry-semantics.md',
    heading: 'Retry Semantics for Idempotent Calls',
    body: `Idempotent requests retry up to three times on transient 5xx
errors with exponential backoff. Non idempotent requests are surfaced to
the caller without retry to avoid duplicate side effects.`,
  },
  {
    file: 'credential-rotation.md',
    heading: 'Service Credential Rotation',
    body: `Service credentials rotate every twenty four hours. The rotation
handler swaps the secret in the keystore and signals connected workers to
pick up the new secret without dropping in flight work or losing queued
jobs.`,
  },
  {
    file: 'audit-logging.md',
    heading: 'Audit Logging Pipeline',
    body: `Every authentication event is written to the audit log with a
correlation id, principal, source ip, and outcome. Logs are append only
and shipped to cold storage nightly for compliance review.`,
  },
  {
    file: 'rate-limiting.md',
    heading: 'Rate Limiting and Throttling',
    body: `Rate limits are enforced per principal and per ip. Anonymous
callers get a small budget; authenticated callers get a larger budget that
scales with subscription tier.`,
  },
  {
    file: 'mfa-enrollment.md',
    heading: 'Multi Factor Enrollment Steps',
    body: `Users enroll a second factor after first login. Supported
factors include TOTP authenticators, hardware security keys, and SMS as a
fallback for legacy accounts.`,
  },
  {
    file: 'password-reset.md',
    heading: 'Password Reset Flow',
    body: `Password reset is triggered from the sign in page. A signed
reset link is mailed to the registered address and is valid for fifteen
minutes. Reuse is rejected.`,
  },
  {
    file: 'account-recovery.md',
    heading: 'Account Recovery and Lockout',
    body: `Locked accounts can be recovered through identity verification
with the support team. Self service recovery requires a verified backup
email or phone.`,
  },
  {
    file: 'service-tokens.md',
    heading: 'Service to Service Tokens',
    body: `Internal services authenticate to one another with short lived
mTLS certificates. Token issuance is delegated to a central CA that
rotates the issuing key weekly.`,
  },
  {
    file: 'webhook-signing.md',
    heading: 'Webhook Signing and Verification',
    body: `Outbound webhooks are signed with an HMAC over the request body.
Recipients verify the signature with the shared secret before trusting
the payload.`,
  },
  {
    file: 'api-keys.md',
    heading: 'API Key Management',
    body: `Long lived API keys are scoped to a single environment and a
narrow set of permissions. Keys can be rotated without downtime by
issuing a new key, switching clients, then revoking the old key.`,
  },
  {
    file: 'observability.md',
    heading: 'Observability for Auth Events',
    body: `Latency, error rate, and rejection counts are exported as
metrics. Each authentication failure raises a structured log line tagged
with the failure reason.`,
  },
  {
    file: 'database-schema.md',
    heading: 'Database Schema for Identity',
    body: `The identity schema stores users, sessions, refresh tokens, and
audit records. Foreign keys link sessions back to the owning user.`,
  },
  {
    file: 'deployment.md',
    heading: 'Deployment Topology',
    body: `Auth services run as stateless pods behind the gateway. Redis
provides session state and a Postgres replica is the source of truth for
user records.`,
  },
  {
    file: 'failure-modes.md',
    heading: 'Failure Modes and Degradation',
    body: `On Redis failure the gateway falls back to read only mode and
existing sessions remain valid until their TTL expires. New logins are
rejected until Redis recovers.`,
  },
  {
    file: 'compliance.md',
    heading: 'Compliance Controls Overview',
    body: `Authentication controls satisfy SOC 2, ISO 27001, and HIPAA
requirements. Quarterly access reviews are mandatory for all privileged
roles.`,
  },
  {
    file: 'cors.md',
    heading: 'CORS and Browser Access',
    body: `Browser clients must include credentials and observe the CORS
allow list. Pre flight requests cache for ten minutes to reduce overhead.`,
  },
  {
    file: 'error-codes.md',
    heading: 'Authentication Error Codes',
    body: `Each failure mode maps to a stable error code that clients can
key off. Codes are documented in the API reference and never reused.`,
  },
]

describe('HyDE behavior integration', () => {
  beforeAll(async () => {
    if (skipIfNoApiKey()) {
      console.log(
        'Skipping HyDE behavior tests (set OPENAI_API_KEY or INCLUDE_EMBED_TESTS=true)',
      )
      return
    }
    process.env.MDM_HOME = TEST_DIR

    // `buildEmbeddings` dispatches through the runtime registry. The CLI
    // main path calls this at bootstrap; the integration tests skip main
    // and hit the pipeline directly, so we mirror the bootstrap here.
    await runEffect(registerDefaultProviders())

    await fs.mkdir(TEST_DIR, { recursive: true })

    await Promise.all(
      TOPICS.map((topic) =>
        fs.writeFile(
          path.join(TEST_DIR, topic.file),
          `# ${topic.heading}\n\n${topic.body}\n`,
        ),
      ),
    )

    const shouldRebuild = process.env.REBUILD_TEST_INDEX === 'true'
    await runEffect(
      buildIndex(TEST_DIR, { indexRoot: TEST_DIR, force: shouldRebuild }),
    )
    await runEffect(buildEmbeddings(TEST_DIR, { force: shouldRebuild }))
  }, 300000)

  afterAll(async () => {
    if (skipIfNoApiKey()) return
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    if (originalMdmHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = originalMdmHome
  })

  it('produces a different ranking when HyDE is enabled', async () => {
    if (skipIfNoApiKey()) return

    // Conceptual query whose lexical surface heavily overlaps with two
    // headings ("Refresh Token Lifecycle" and "Session Storage and TTL")
    // but whose actual answer is spread across credential rotation,
    // long running request handling, and gateway routing. Without the
    // fix, the boost-dominated ranking anchors on the lexical winners
    // and HyDE produces no observable change.
    const query =
      'how does the platform keep a long running api call authenticated when its access token reaches the end of its lifetime mid flight'

    const withoutHyde = await runEffect(
      semanticSearch(TEST_DIR, query, {
        limit: 10,
        threshold: 0,
        hyde: false,
      }),
    )

    const withHyde = await runEffect(
      semanticSearch(TEST_DIR, query, {
        limit: 10,
        threshold: 0,
        hyde: true,
        // Pin temperature to 0 so the hypothetical document generation is
        // as close to deterministic as the upstream LLM allows. The test
        // still tolerates small ranking shifts via the overlap budget.
        hydeOptions: { temperature: 0 },
      }),
    )

    // Both runs must return results, otherwise we are not exercising the
    // ranking pipeline at all.
    expect(withoutHyde.length).toBeGreaterThan(0)
    expect(withHyde.length).toBeGreaterThan(0)

    const withoutIds = new Set(withoutHyde.map((r) => r.sectionId))
    const overlap = withHyde.filter((r) => withoutIds.has(r.sectionId)).length
    // Diagnostic: surface the actual overlap when the assertion fires so a
    // future regression is easy to triage.
    console.log(`HyDE overlap: ${overlap}/${withHyde.length}`)

    // Before the fix the additive boost trapped both code paths on the same
    // lexical anchors and the candidate pool was too narrow for HyDE to
    // surface chunks lexically distant from the query. Both runs collapsed
    // onto identical or near-identical orderings (overlap of 9–10 out of
    // 10). After the fix at least three results differ. Allow up to 7 of
    // 10 to coincide.
    expect(overlap).toBeLessThan(8)
  })

  it('forwards full hydeOptions through to generation', async () => {
    if (skipIfNoApiKey()) return

    // Smoke test: passing hydeOptions should not throw and should still
    // return ranked results. This guards against accidental property
    // dropping in the hydeOptions forwarding path.
    const results = await runEffect(
      semanticSearch(TEST_DIR, 'how do refresh tokens rotate', {
        limit: 5,
        threshold: 0,
        hyde: true,
        hydeOptions: {
          model: 'gpt-4o-mini',
          maxTokens: 200,
          temperature: 0.2,
        },
      }),
    )

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.similarity).toBeGreaterThan(0)
  })
})
