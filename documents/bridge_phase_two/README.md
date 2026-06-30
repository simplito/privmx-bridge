# Bridge Phase 2 — key epochs & forward-secrecy support (privmx-bridge)

Phase 2 adds the **server-side mechanics** that let the endpoint achieve cryptographic **forward secrecy** of
group-granted content after a removal, and resolve concurrent rotations cleanly. It builds directly on the
Phase-1 bridge (groups are implemented; the bridge is store-only and verifies no crypto).

This directory is the bridge half. The client half is [../endpoint_phase_two/](../endpoint_phase_two/).
Background/design: [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §2/§4/§5 and the issue list
[../plan/09-endpoint-issues-and-roadmap.md](../plan/09-endpoint-issues-and-roadmap.md) "Phase 2" (issues
**BR-1..BR-5**).

---

## The six features (and which side owns them)

| Feature | Bridge owns | Endpoint owns |
|---------|-------------|---------------|
| Key **epochs** (`keyVersion`/`keyHistory`) | store + serve the epoch counter & past pubkeys (BR-1) | commit epoch in the DIO; keep `{epoch→key}` map |
| **`generateNewGroupKey`** | new RPC + service op, epoch bump (BR-2) | call it; mint fresh epoch keypair |
| Optimistic **CAS + `ROTATED_ALREADY`** | atomic CAS on `keyVersion`; rejection carries winner envelope (BR-3) | catch + adopt + retry |
| **Key-confirmation tag** | store/serve it opaquely on the rotation payload | emit on rotate; verify before adopting |
| **Rotation rate-limit** | enforce per (group, actor) + manager-only (BR-4) | back off / surface |
| **Lazy re-key on write** | per-epoch coverage check on container re-key (BR-5) | the algorithm itself (the big piece) |

So the bridge's Phase-2 job is **epoch metadata + concurrency control + coverage + rate-limit** — all
server-side concerns that need **no crypto verification** (consistent with the store-only model). The actual
forward-secrecy crypto (fresh epoch keypairs, lazy re-key, confirmation) is the endpoint's.

> **Decision — rotation is decoupled from `groupUpdate`.** `groupUpdate` is **membership/metadata only** and
> **cannot rotate the key** (it rejects any `groupPubKey` change and never bumps `keyVersion`). The **only**
> rotation method is **`generateNewGroupKey`** (which cannot add/remove members). A secure removal is two ops:
> `groupUpdate` (drop the member) then `generateNewGroupKey` (rotate the epoch). This keeps "manage members"
> and "rotate keys" as separable capabilities.

---

## Consistency with the store-only model (important)

Phase 1 dropped `GroupMembershipSignature`: the bridge verifies nothing and the membership proof lives in the
endpoint DIO inside `data`. Phase 2 keeps that:

- `keyVersion` is a **real bridge field** because it's the **CAS token** (the bridge must atomically
  compare-and-set it). It is *also* committed by the endpoint inside the `data` DIO (`membership.keyVersion`),
  so the epoch↔pubkey binding stays **client-verifiable** — the client cross-checks bridge `keyVersion` ==
  DIO-committed epoch, exactly as it cross-checks `users`/`managers` in Phase 1
  ([../endpoint_phase_one/03-verification.md](../endpoint_phase_one/03-verification.md)).
- `keyHistory`, `groupEpoch` tags, and the confirmation tag are stored/served **opaquely**; the bridge never
  interprets key material.
- The bridge's new enforcement (CAS, per-epoch coverage, rate-limit) protects honest clients against a
  malicious *member* (anti-ghosting/spam) and resolves races — it is **not** a trust anchor for integrity
  (that remains the client's DIO verification).

---

## Status
All 🟡 **not started**. Phase-1 bridge code is the baseline (committed on `feat/group-api`). Phase 2 is
additive and **backward-compatible**: a pre-epoch group has no `keyVersion` (treat as epoch 1); a pre-epoch
container `groupKeys` entry has no `groupEpoch` (treat as "current" — never stale until first rotation). See
[../plan/07-backward-compatibility-and-migration.md](../plan/07-backward-compatibility-and-migration.md) §8.

---

## Reading order

| # | Document | Covers |
|---|----------|--------|
| 1 | [01-data-model.md](./01-data-model.md) | `keyVersion`/`keyHistory` on the group; `groupEpoch` on container key entries; `ROTATED_ALREADY` code; indexes & migration |
| 2 | [02-services-and-rpc.md](./02-services-and-rpc.md) | `generateNewGroupKey`, the `keyVersion` CAS, the `ROTATED_ALREADY` winner-envelope, rate-limit, per-epoch coverage — with order-of-operations |
| 3 | [03-flows.md](./03-flows.md) | Bridge-side flows (rotation+CAS, ROTATED_ALREADY, generateNewGroupKey, container re-key coverage) |

---

## Bridge files Phase 2 touches (anchors)

| Concern | File |
|---------|------|
| Group doc + epoch fields, container `groupKeys` epoch tag | [../../src/db/Model.ts](../../src/db/Model.ts) |
| Repo CAS + epoch bump | [../../src/service/cloud/GroupRepository.ts](../../src/service/cloud/GroupRepository.ts) |
| `generateNewGroupKey`, rate-limit, rotation orchestration | [../../src/service/cloud/GroupService.ts](../../src/service/cloud/GroupService.ts) |
| Per-epoch coverage | [../../src/service/cloud/CloudKeyService.ts](../../src/service/cloud/CloudKeyService.ts) |
| RPC method + types + validator | [../../src/api/main/context/ContextApi.ts](../../src/api/main/context/ContextApi.ts), `ContextApiTypes.ts`, `ContextApiValidator.ts` |
| `ROTATED_ALREADY` error code | [../../src/api/AppException.ts](../../src/api/AppException.ts) |
| Container `groupKeys` epoch tag wiring | each `*Service` / `*ApiTypes` / `*Repository` |
