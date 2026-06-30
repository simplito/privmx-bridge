# Group API — implementation plan (privmx-bridge + privmx-endpoint)

This directory is the **detailed implementation plan** for the Group feature: the bridge (server) contract
and behaviour, the endpoint (client library) design, all flows and their consequences, and a full
backward-compatibility / migration analysis.

> **⚠️ Current design (applied in code).** The bridge does **not** sign or verify group data —
> `GroupMembershipSignature` was dropped. Membership integrity (author signature + member set + chain link)
> is committed by the endpoint **inside the opaque `data`** as a `DataIntegrityObject` and verified
> client-side. The bridge stores group state + an append-only version `history` and enforces ACL,
> key-coverage, the `version` optimistic-concurrency check, and `GROUP_IN_USE`. Rationale + endpoint
> requirements: [10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md)
> (§3b records the decision). The standalone [../groupMembershipSignature.md](../groupMembershipSignature.md)
> spec is **obsolete** for this reason.

It supersedes the earlier scratch docs for day-to-day implementation. The earlier docs remain as background:
- [../groupApi-architecture.md](../groupApi-architecture.md) — original architecture write-up.
- [../groupApi-endpoint-guide.md](../groupApi-endpoint-guide.md) — original short endpoint guide.
- [../groupMembershipSignature.md](../groupMembershipSignature.md) — signed-log byte spec.
- [../group-architecture-and-flows.md](../group-architecture-and-flows.md) — glossary + flows.
- [../group-mls-lite-plan.md](../group-mls-lite-plan.md) — the "MLS-lite" key-versioning plan and the
  MLS forward-compatibility analysis (§8/§9). The MLS-lite extension is referenced from here as **planned**.

---

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [01-architecture-overview.md](./01-architecture-overview.md) | What a Group is, the key hierarchy, the layer map, what's done vs planned |
| 2 | [02-bridge-api-contract.md](./02-bridge-api-contract.md) | Every RPC method, request/response shape, validators, error codes |
| 3 | [03-data-model-and-consequences.md](./03-data-model-and-consequences.md) | DB schema changes, indexes, and **every consequence** of each change |
| 4 | [04-bridge-implementation.md](./04-bridge-implementation.md) | Service/repo/policy/ACL/IOC wiring, coverage checks, the signed log |
| 5 | [05-flows.md](./05-flows.md) | **All flows** end-to-end (create/add/remove/grant/read/re-key/delete/teardown) |
| 6 | [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) | Client-side (C++ endpoint) crypto, state, ops, verification, lazy re-key |
| 7 | [07-backward-compatibility-and-migration.md](./07-backward-compatibility-and-migration.md) | Old/new clients × old/new containers, migration, app-exception behaviour |
| 8 | [08-future-plans.md](./08-future-plans.md) | Deferred scope — **delta `modifyMembers`** (full description) + roadmap index |
| 9 | [09-endpoint-issues-and-roadmap.md](./09-endpoint-issues-and-roadmap.md) | **Checkpoint** (works/not), **endpoint issues** (EP-n) for parity, + **Phase 2** (epochs/FS) as BR-n/EP-n issues |
| 10 | [10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md) | **Existing endpoint security (DIO/UserVerifier)**, precedence ruling (reuse not reinvent), **gaps G1–G5 + solutions**, plan changes |

### Wire reference (for integrators)
- [../group-api-reference.md](../group-api-reference.md) — **API + flows + example JSON payloads** for every
  `context.group*` method and group-as-grantee on containers, reflecting the current Phase 1 + Phase 2 bridge.

### Per-phase implementation guides (authoritative for building)
These `documents/`-level directories are the actionable, code-grounded build guides; the docs above are the
design/contract reference they draw on:
- [../endpoint_phase_one/](../endpoint_phase_one/) — **Phase 1 endpoint** (C++): make groups work against the
  current store-only bridge (modules, keys+DIO, verification, group-as-grantee, flow changes).
- [../bridge_phase_two/](../bridge_phase_two/) — **Phase 2 bridge**: epochs/`keyVersion`, `generateNewGroupKey`,
  CAS + `ROTATED_ALREADY`, rate-limit, per-epoch coverage.
- [../endpoint_phase_two/](../endpoint_phase_two/) — **Phase 2 endpoint**: epoch bookkeeping, rotation/CAS,
  key-confirmation, **lazy re-key on write** (forward secrecy).

---

## Status legend

Each item in these docs is tagged with one of:

- ✅ **Implemented** — present on branch `feat/group-api` in this repo.
- 🟡 **Planned / deferred** — designed but **not part of the current supported scope**: the delta
  **`groupModifyMembers`** path (deferred in favour of full-replace `groupUpdate` for v1 — full description in
  [08-future-plans.md](./08-future-plans.md)); group key **epochs** (`keyVersion`/`keyHistory`),
  `generateNewGroupKey`, optimistic CAS + `ROTATED_ALREADY`, key-confirmation tag, rotation rate-limiting, and
  the `GroupRole {READ,WRITE,PUSH}` migration (designed in
  [../group-mls-lite-plan.md](../group-mls-lite-plan.md)). Lazy re-key on write is the corresponding
  **endpoint** work.
- 🔵 **Endpoint** — client-side work that lives in the separate `privmx-endpoint` (C++) repo.

When a doc says "today" / "currently" it means the ✅ implemented state. "Will" / "planned" means 🟡.

---

## One-paragraph summary

A **Group** is a context-scoped, end-to-end-encrypted, container-like resource with `users`, `managers`, an
opaque `data` blob, a symmetric data key (`keyId`), and a **stable identity public key** (`groupPubKey`). It
behaves like a *container* for its own lifecycle (CRUD on `ContextApi` as `context.group*`) and like a
*member* for other containers: thread/store/inbox/kvdb/stream can grant access to a group by wrapping their
content key once to `groupPubKey`. Every membership change is carried in an append-only, **signed, chained
membership log** so the untrusted bridge cannot forge, drop, or reorder changes — the endpoint verifies the
chain client-side. Access revocation is **immediate at the bridge** (server refuses removed members) and
cryptographic forward secrecy is achieved by **lazily re-keying** each container on its next write. The whole
feature is **additive and backward-compatible**: all new container fields are optional, so old clients are
unaffected (see doc 7).
