# Endpoint Phase 2 — epochs & forward secrecy (privmx-endpoint, C++)

Phase 2 is where the endpoint earns **cryptographic forward secrecy**: after a member is removed, they cannot
read **new** group content or **new** content of containers the group grants into. It builds directly on
[../endpoint_phase_one/](../endpoint_phase_one/) (groups work; membership integrity is in the `data` DIO,
verified client-side) and on the Phase-2 bridge mechanics [../bridge_phase_two/](../bridge_phase_two/).

Design background: [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §3–§5,
[../plan/09-endpoint-issues-and-roadmap.md](../plan/09-endpoint-issues-and-roadmap.md) "Phase 2" (issues
**EP-9..EP-14**), [../plan/05-flows.md](../plan/05-flows.md) §4/§5c/§7.

---

## What Phase 2 adds (endpoint side)

| Capability | Issue | Doc |
|------------|-------|-----|
| **Epoch bookkeeping** — per group `{epoch → (GroupPriv, Gk)}`, current epoch, all rebuildable from the bridge | EP-9 | [01-epochs.md](./01-epochs.md) |
| **Fresh-epoch keypair on removal** + `generateNewGroupKey` call | EP-10 | [02-rotation-cas-confirmation.md](./02-rotation-cas-confirmation.md) |
| **`ROTATED_ALREADY` handling** — adopt winner envelope, retry, no extra round trip | EP-11 | [02-rotation-cas-confirmation.md](./02-rotation-cas-confirmation.md) |
| **Key-confirmation tag** — emit on rotate; verify before adopting (anti garbage-key) | EP-12 | [02-rotation-cas-confirmation.md](./02-rotation-cas-confirmation.md) |
| **Lazy re-key on write** — the core new algorithm (forward secrecy of container content) | EP-13 | [03-lazy-rekey.md](./03-lazy-rekey.md) |
| **Epoch-tagged key-entry selection on read** | EP-14 | [01-epochs.md](./01-epochs.md) §3 |

---

## The core idea (one paragraph)

A group key is no longer a single stable keypair; it's a sequence of **independent random** epoch keypairs
`(GroupPub_v, GroupPriv_v)` plus per-epoch data keys `Gk_v`. Rotation is a **dedicated op**
(`generateNewGroupKey`) — **decoupled from membership** (`groupUpdate` cannot rotate; the rotation op cannot
change members). A secure removal is two calls: `groupUpdate` (drop the member) then `generateNewGroupKey`
(**mint a new epoch** wrapped only to the remaining members) — so the removed member holds keys for epochs ≤
their removal and **cannot derive** the next epoch (epochs are independent random, *not* a forward-derivable
hash chain — that's deliberate). Content
encrypted under the new epoch is unreadable to them. **Containers** that grant to the group are caught up
**lazily**: on the next write, the writer notices the container's stored `groupEpoch` is behind the group's
current `keyVersion` and **re-keys** the container's content key to the group's current epoch pubkey. Old
content keeps its old key (you can't un-share the past).

---

## Forward secrecy vs PCS (be precise)

Phase 2 gives **forward secrecy** (removed members lose access to *future* content) — **not** post-compromise
security. PCS would require healing the per-member delivery channel with fresh entropy under rotating leaf
keys; our asymmetric group-as-grantee model precludes it without a different scheme. See
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §7–§9. Don't claim PCS.

---

## Builds on Phase 1 — what stays
- The membership proof (member set + chain link) stays committed in the `data` DIO and verified on read; Phase
  2 just **adds `keyVersion` to that committed membership block** so the epoch↔pubkey binding is
  client-verifiable (cross-checked against the bridge's CAS field).
- `UserVerifier`, DIO, `EncKeyEncryptorV2`, `KeyProvider` — all reused. No new crypto primitive; epochs are new
  *bookkeeping* + the lazy-re-key *algorithm*.
- Statelessness is **softened**: clients still rebuild from the bridge (no commit-replay engine), but must now
  retain the **set of epoch private keys they're entitled to** (still re-fetchable from epoch-tagged key
  entries — see [01-epochs.md](./01-epochs.md) §2).

---

## Status
All 🟡 **not started**. Phase-1 endpoint must exist first. Phase 2 requires the matching Phase-2 **bridge**
work (epoch field + CAS + `ROTATED_ALREADY` + per-epoch coverage + rate-limit) — each endpoint doc notes its
bridge dependency (BR-n).

---

## Reading order
1. [01-epochs.md](./01-epochs.md) — epoch state, DIO commitment, read selection (EP-9, EP-14).
2. [02-rotation-cas-confirmation.md](./02-rotation-cas-confirmation.md) — rotate, `generateNewGroupKey`,
   `ROTATED_ALREADY`, confirmation tag (EP-10/11/12).
3. [03-lazy-rekey.md](./03-lazy-rekey.md) — the lazy-re-key-on-write algorithm (EP-13) — the heart of Phase 2.
4. [04-flows.md](./04-flows.md) — end-to-end flows (before/after Phase 1).
