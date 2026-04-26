# Aegis Ledger — Architecture Walkthrough

> Internal developer reference documenting the full system architecture, file-by-file logic mapping, and implementation decisions made during the 4-stage build sprint.

---

## Build Timeline

| Stage | What | Key Decisions |
|---|---|---|
| **Stage 1: Foundation** | Next.js 14 init, all client libraries, DB schema, crypto module | Per-auditor unique salt (not global pepper); lazy Redis init; `@supabase/supabase-js` for service client (not `@supabase/ssr`) |
| **Stage 2: Vault API** | `/api/payroll` POST, `/api/payroll/[id]` GET, `/api/health` GET | Redis SET NX mutex scoped to org_id; atomic Lua release; partial failure handling (no rollback — Cloak txs are irreversible) |
| **Stage 3: Audit API** | 4 audit endpoints: generate-key, magic-link, verify, decrypt | Stateless JWT (no sessions table); single-use Redis magic links; 3-layer temporal enforcement |
| **Stage 4: God Mode UI** | xterm.js terminal, ReactFlow graph, SSE stream, both pages | Dynamic imports (no SSR for xterm/ReactFlow); demo mode for judges; staggered node animation |

---

## Complete File Tree

```
src/
├── app/
│   ├── api/
│   │   ├── audit/
│   │   │   ├── decrypt/
│   │   │   │   └── route.ts        ← POST: JWT verify → AES decrypt → Cloak scanTransactions → compliance report
│   │   │   ├── generate-key/
│   │   │   │   └── route.ts        ← POST: Cloak generateUtxoKeypair → HKDF → AES-256-GCM encrypt → Supabase
│   │   │   ├── magic-link/
│   │   │   │   └── route.ts        ← POST: identity verify → sign JWT → Redis SET (15min TTL) → magic link URL
│   │   │   └── verify/
│   │   │       └── route.ts        ← GET:  Redis GET+DEL (single-use) → return JWT to browser
│   │   ├── health/
│   │   │   └── route.ts            ← GET:  ping Supabase + Redis, return latency
│   │   └── payroll/
│   │       ├── [id]/
│   │       │   └── route.ts        ← GET:  payroll run status + commitment hashes
│   │       ├── route.ts            ← POST: Zod validate → Redis mutex → Cloak deposit+withdraw loop → Supabase
│   │       └── stream/
│   │           └── route.ts        ← GET:  SSE stream of simulated payroll execution logs
│   ├── audit/
│   │   └── page.tsx                ← Auditor Portal: magic link consumer + ReactFlow graph
│   ├── fonts/
│   │   ├── GeistMonoVF.woff
│   │   └── GeistVF.woff
│   ├── favicon.ico
│   ├── globals.css                 ← Full design system: CSS vars, glass cards, terminal, ReactFlow nodes, animations
│   ├── layout.tsx                  ← Root layout with SEO metadata
│   └── page.tsx                    ← Public Dashboard: xterm.js terminal + feature cards
├── components/
│   ├── AuditGraph.tsx              ← ReactFlow: Treasury → Encrypted UTXOs → Decrypted payments
│   └── PayrollTerminal.tsx         ← xterm.js terminal with SSE EventSource streaming
├── lib/
│   ├── cloak.ts                    ← Solana Connection + treasury Keypair (from filesystem) + Cloak constants
│   ├── crypto.ts                   ← AES-256-GCM encrypt/decrypt + HKDF key derivation + salted identity hashing
│   ├── redis.ts                    ← Lazy Redis singleton + SET NX distributed mutex + atomic Lua release
│   ├── supabase/
│   │   ├── client.ts               ← Browser Supabase (anon key, subject to RLS)
│   │   └── server.ts               ← Server Supabase: cookie-based (anon) + createClient (service_role, no generic)
│   └── validation.ts               ← Zod schemas: payroll, generate-key, magic-link, decrypt requests
└── types/
    └── database.ts                 ← TypeScript ↔ PostgreSQL schema types with Relationships for postgrest-js v2.104+
```

### Non-src Files

```
supabase/migrations/001_foundation.sql  ← 5 tables, RLS, CHECK constraints, updated_at trigger
.env.example                             ← Template with all required env vars documented
.env.local                               ← Live credentials (gitignored)
.gitignore                               ← Excludes .env*.local, treasury-keypair.json
package.json                             ← 12 deps, 4 devDeps
tsconfig.json                            ← target ES2020 (BigInt support for Cloak SDK)
tailwind.config.ts                       ← Default Tailwind v3 config
next.config.mjs                          ← Vanilla Next.js config
```

---

## Lib Layer — Detailed Logic Mapping

### `src/lib/crypto.ts` — Cryptographic Primitives

**Purpose:** AES-256-GCM encryption for viewing keys at rest + salted identity hashing.

| Export | Signature | Logic |
|---|---|---|
| `deriveKey(keyId)` | `(string) → Buffer` | `HKDF-SHA256(ikm=AEGIS_MASTER_SECRET, salt=keyId, info="aegis-viewing-key", length=32)` |
| `encryptViewingKey(plaintext, keyId)` | `(Buffer, string) → Buffer` | Derive key → `randomBytes(12)` IV → `createCipheriv("aes-256-gcm")` → return `iv(12) \|\| authTag(16) \|\| ciphertext(N)` |
| `decryptViewingKey(packed, keyId)` | `(Buffer, string) → Buffer` | Derive key → slice `iv`, `authTag`, `ciphertext` → `createDecipheriv` → `setAuthTag` → return plaintext |
| `hashAuditorIdentity(identity, salt)` | `(string, string) → string` | `SHA-256(salt \|\| identity)` → hex digest |
| `generateAuditorSalt()` | `() → string` | `randomBytes(32).toString("hex")` |

**Key invariant:** `getMasterSecret()` throws if `AEGIS_MASTER_SECRET` is not exactly 64 hex chars (32 bytes).

---

### `src/lib/redis.ts` — Distributed Mutex

**Purpose:** Prevent concurrent UTXO selection for the same organization.

| Export | Logic |
|---|---|
| `getRedis()` | Lazy singleton via `Redis.fromEnv()`. Prevents build-time crashes during static page generation. |
| `acquireMutex(resource, ttlSeconds)` | `SET "aegis:lock:{resource}" {uuid} NX EX {ttl}`. Returns `{acquired, lockValue, key}`. |
| `releaseMutex(key, lockValue)` | Atomic Lua script: `if GET == lockValue then DEL else 0`. Prevents releasing another caller's lock. |

**Why Lua?** A naive `GET + DEL` has a TOCTOU race — between the GET and DEL, another caller could acquire the lock. The Lua script is atomic within Redis.

**Why org_id scoping?** Different organizations can run payroll concurrently — the mutex only blocks concurrent runs for the *same* org.

---

### `src/lib/cloak.ts` — Solana + Cloak Factory

**Purpose:** Server-only module providing Solana RPC connection and treasury keypair.

| Export | Logic |
|---|---|
| `getConnection()` | Lazy singleton `new Connection(SOLANA_RPC_URL, "confirmed")` |
| `getTreasuryKeypair()` | `readFileSync(TREASURY_KEYPAIR_PATH)` → `Keypair.fromSecretKey(Uint8Array.from(json))` |
| `getProgramId()` | Returns `CLOAK_PROGRAM_ID` constant from SDK |
| `getRelayUrl()` | Returns `CLOAK_RELAY_URL` from env |

**⚠️ This module must NEVER be imported in client components.** It reads filesystem (keypair) and accesses server-only env vars.

---

### `src/lib/validation.ts` — Zod Schemas

**Purpose:** Runtime input validation on all API routes. No raw user input reaches business logic.

| Schema | Key Rules |
|---|---|
| `payrollRequestSchema` | UUID org_id, base58 wallet/mint pubkeys, positive bigint amount strings, 1-50 recipients, `.strict()` |
| `generateKeyRequestSchema` | UUID org_id, 3-256 char identity, ISO 8601 datetime, 1-10 supported token symbols, `valid_until > valid_from` refinement |
| `magicLinkRequestSchema` | UUID viewing_key_id, 3-256 char identity |
| `decryptRequestSchema` | Optional limit (1-1000, default 250) |

**Solana pubkey regex:** `/^[1-9A-HJ-NP-Za-km-z]+$/` — base58 alphabet excluding 0, O, I, l (ambiguous characters).

---

### `src/lib/supabase/server.ts` — Two Client Variants

| Export | Client | Use Case |
|---|---|---|
| `createClient()` | `createServerClient<Database>` from `@supabase/ssr` | Server Components, Server Actions — uses cookies for session |
| `createServiceClient()` | `createSupabaseClient` from `@supabase/supabase-js` | API routes — uses `service_role` key, bypasses RLS |

**Why two?** The service client doesn't need cookies (it's not session-based) and avoids the `never` type inference bug in `@supabase/postgrest-js` v2.104+ when using `@supabase/ssr` with strict generics. The `Database` generic is intentionally omitted from the service client — Zod validates all inputs anyway.

---

## API Route Logic — Detailed Flows

### `POST /api/payroll` — Batch Shielded Payroll

```
1. Parse JSON body
2. Validate with payrollRequestSchema (Zod)
3. Cross-validate token_mint against TOKEN_MINTS map
4. Verify org exists in Supabase
5. Acquire Redis mutex: SET NX "utxo-selection:{org_id}" TTL=60s
6. Calculate total amount (BigInt sum)
7. INSERT payroll_run (status: "processing")
8. For each recipient:
   a. generateUtxoKeypair() → owner
   b. createUtxo(amount, owner, mint) → outputUtxo
   c. transact({inputUtxos: [zeroUtxo], outputUtxos: [outputUtxo], ...}) → deposit
   d. fullWithdraw(outputUtxos, recipientPubkey, ...) → withdraw
   e. Collect tx signatures and commitment hashes
9. UPDATE payroll_run → status: "completed"
10. INSERT payroll_recipients (commitment hashes)
11. INSERT audit_log (payroll_completed)
12. FINALLY: releaseMutex() — runs on success, failure, OR exception
```

**Partial failure:** If payment N fails, payments 0..N-1 are already on-chain (irreversible). The run is marked `failed` with `error_message` recording which index failed and what went wrong.

---

### `POST /api/audit/generate-key` — Viewing Key Creation

```
1. Validate with generateKeyRequestSchema
2. Verify org exists
3. Cloak: generateUtxoKeypair() → privateKey → getNkFromUtxoPrivateKey() → nk (32 bytes)
4. key_id = crypto.randomUUID()
5. derivedKey = HKDF(AEGIS_MASTER_SECRET, salt=key_id, info="aegis-viewing-key", 32)
6. ciphertext = AES-256-GCM(nk, derivedKey) → iv || authTag || encrypted
7. identitySalt = randomBytes(32).toString("hex")
8. identityHash = SHA-256(identitySalt || auditor_identity)
9. INSERT viewing_keys: {key_id, ciphertext(base64), valid_from, valid_until, allowed_tokens, identityHash, identitySalt}
10. INSERT audit_log (viewing_key_created)
11. Response: {viewing_key_id, key_id} — NO raw key material
```

**The raw nk is never persisted.** It exists only in Node.js heap memory during this request, then is garbage collected.

---

### `POST /api/audit/magic-link` — Single-Use Access Link

```
1. Validate with magicLinkRequestSchema
2. Fetch viewing_key record from Supabase
3. Re-hash: SHA-256(stored_salt || provided_identity) → compare with stored hash
4. Check: not revoked, not expired
5. Sign JWT: {sub: identityHash, vk_id, key_id, org_id, valid_from, valid_until, allowed_tokens}
   - Algorithm: HS256
   - Secret: AEGIS_MASTER_SECRET (TextEncoder encoded)
   - Expiration: valid_until
6. magicToken = randomUUID()
7. Redis SET "aegis:magic-link:{magicToken}" = JWT (TTL 900s / 15 min)
8. Return: {magic_link: "https://.../audit?token={magicToken}", expires_in: 900}
```

---

### `GET /api/audit/verify?token=` — Magic Link Consumer

```
1. Extract token from query params
2. Redis GET "aegis:magic-link:{token}" → JWT
3. If null → 410 Gone (expired or already used)
4. Redis DEL "aegis:magic-link:{token}" → single-use consumed
5. Return: {access_token: JWT, token_type: "Bearer"}
```

**The token is opaque (UUID) — not the JWT itself.** This prevents JWT exposure in browser history, referrer headers, or URL logs.

---

### `POST /api/audit/decrypt` — Selective Decryption

```
1. Extract Bearer JWT from Authorization header
2. jwtVerify(token, AEGIS_MASTER_SECRET, {issuer: "aegis-ledger"})
3. Extract scope claims: vk_id, key_id, org_id, valid_from, valid_until
4. Fetch encrypted viewing key from Supabase
5. Verify: not revoked, within temporal bounds, key_id matches JWT claim
6. Decrypt: AES-256-GCM(ciphertext, HKDF(AEGIS_MASTER_SECRET, key_id))
7. Cloak: scanTransactions({viewingKeyNk: decryptedNk, limit})
8. toComplianceReport(scanResult)
9. Filter transactions by temporal scope (valid_from ≤ tx.timestamp ≤ valid_until)
10. Return: {audit: {org_id, scope, summary, transactions}} — NO raw key in response
```

**3-layer temporal enforcement:**
1. **JWT level:** `exp` claim set to `valid_until`
2. **DB level:** `CHECK (valid_until > valid_from)` constraint
3. **Runtime level:** JavaScript filter on transaction timestamps

---

## Frontend Components

### `PayrollTerminal.tsx`

- **Library:** `@xterm/xterm` v6 + `@xterm/addon-fit`
- **Streaming:** `EventSource("/api/payroll/stream")` — Server-Sent Events
- **Protocol:** Each SSE `data:` is a JSON-encoded ANSI string
- **Termination:** `"__DONE__"` sentinel value closes the EventSource
- **Theme:** Custom 16-color palette matching the glassmorphism design system
- **Font:** `var(--font-geist-mono)` with fallbacks to JetBrains Mono, Fira Code
- **Import:** `dynamic(() => import("..."), { ssr: false })` — xterm requires DOM

### `AuditGraph.tsx`

- **Library:** ReactFlow v11
- **Custom nodes:** 3 types registered via `nodeTypes` map:
  - `treasury` — indigo border, centered, "AEGIS TREASURY" label
  - `encrypted` — red border, lock icon, truncated commitment hash
  - `decrypted` — green border, unlock icon, amount + recipient label
- **Animation:** `applyViewingKey()` loops 5 nodes with 400ms stagger:
  1. Replace node type `encrypted` → `decrypted`
  2. Replace node data (hash → amount/label)
  3. Animate edge color purple → green + dashed animation
- **API integration:** Calls `POST /api/audit/decrypt` with Bearer token (falls back to demo data if API fails)

---

## Database Schema — Critical Notes

### `viewing_keys` Table — Security Annotations

```sql
-- Column: encrypted_viewing_key (bytea)
-- Contains: iv(12 bytes) || authTag(16 bytes) || AES-256-GCM ciphertext
-- NOT the raw viewing key
-- Decryption requires: HKDF(AEGIS_MASTER_SECRET, salt=key_id)

-- Column: auditor_identity_salt (text)
-- Per-key unique salt. NOT a global pepper.
-- Hash computation: SHA-256(salt || identity)
-- Each viewing key has a different salt, so:
--   - Same auditor identity hashes differently across keys
--   - Compromising one salt doesn't help with other keys
--   - No rainbow table precomputation possible

-- Column: key_id (text, UNIQUE)
-- The HKDF "salt" parameter — globally unique
-- The derived encryption key is: HKDF(master_secret, salt=key_id, info="aegis-viewing-key", 32)
```

### RLS Configuration

All 5 tables have RLS enabled with a single policy: `auth.role() = 'service_role'`. The anon key cannot read or write any of these tables. All data access goes through the `createServiceClient()` which uses the service role key.

---

## Known Issues & Workarounds

| Issue | Workaround | Root Cause |
|---|---|---|
| `@supabase/postgrest-js` v2.104 `never` type on insert | Removed `Database` generic from service client | New postgrest-js requires `Relationships` key in table definitions; even with it, generic inference fails for some operations |
| Zod v4 `errorMap` API change | Use `message` string instead of `errorMap` function | Zod v4 changed the `z.enum()` second parameter shape |
| `target: "ES5"` breaks BigInt | Added `"target": "ES2020"` to tsconfig | Cloak SDK uses `0n` BigInt literals which require ES2020+ |
| `Redis.fromEnv()` at module level crashes build | Lazy `getRedis()` singleton | Next.js evaluates module-level code during static page generation when env vars aren't available |
| Browser subagent DNS failures during testing | Verified via `read_url_content` + dev server logs | Antigravity browser tool had network connectivity issues — not a code problem |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `SOLANA_RPC_URL` | ✅ | Solana RPC endpoint (devnet: `https://api.devnet.solana.com`) |
| `CLOAK_RELAY_URL` | ✅ | Cloak relay endpoint (`https://api.cloak.ag`) |
| `TREASURY_KEYPAIR_PATH` | ✅ | **Absolute path** to Solana keypair JSON file |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-only) |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST token |
| `AEGIS_MASTER_SECRET` | ✅ | 64-char hex (32 bytes) — HKDF root for all viewing key encryption |

---

## Deployment Notes (Vercel)

1. Push to GitHub (ensure `treasury-keypair.json` and `.env*.local` are gitignored)
2. Import project in Vercel
3. Add all env vars in Vercel Dashboard → Settings → Environment Variables
4. For `TREASURY_KEYPAIR_PATH`: you'll need to either:
   - Base64-encode the keypair and decode it at runtime (recommended for production)
   - Or use Vercel's filesystem (the keypair file must be committed or injected at build time)
5. Build command: `npm run build`
6. Output directory: `.next`

---

*Last updated: 2026-04-26 · Built during Colosseum Frontier Hackathon Sprint*
