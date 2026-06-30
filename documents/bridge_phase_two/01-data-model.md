# 01 — Data model & error codes (Phase 2)

All changes are **additive** to the Phase-1 schema. Source: [../../src/db/Model.ts](../../src/db/Model.ts),
[../../src/types/cloud.ts](../../src/types/cloud.ts), [../../src/api/AppException.ts](../../src/api/AppException.ts).

---

## 1. `db.group.Group` gains an epoch (BR-1)

```ts
interface Group {
  // ... Phase-1 fields ...
  keyVersion: number;            // NEW: the epoch counter / CAS token. Genesis = 1. Monotonic.
  keyHistory: GroupPubKeyAtEpoch[]; // NEW: past identity pubkeys so clients can find old-epoch keys
}
interface GroupPubKeyAtEpoch { keyVersion: number; groupPubKey: types.cloud.GroupPubKey; }
```

- **`keyVersion`** is the single source of truth for the epoch and the **optimistic-concurrency token**
  (BR-3). The bridge increments it **only on `generateNewGroupKey`** (the dedicated rotation method).
  `groupUpdate` is membership/metadata only and **never** bumps `keyVersion` — it must keep the current
  `groupPubKey` (rejecting any change with `INVALID_PARAMS`). *(Decision: rotation is decoupled from update so
  "manage members" and "rotate keys" are distinct capabilities; see [README](./README.md).)*
- **`keyHistory`** lets a member who joined later (or is offline through rotations) map an old `groupEpoch`
  tag (on a container key entry) back to the `groupPubKey` that epoch used. The bridge appends to it on each
  bump; it never sees private keys.
- The endpoint **also** commits `keyVersion` inside the `data` DIO (`membership.keyVersion`) so the
  epoch↔pubkey binding is client-verifiable (the bridge field is just the CAS token + a serving convenience).

**Backward-compat:** an existing group has neither field → treat `keyVersion` absent as `1` and `keyHistory`
absent as `[]`. No backfill required.

> Decision to make: keep `keyVersion` as a top-level field (cheap CAS) **or** derive it from `history` length
> with a separate `epochOf(version)` map. Recommended: a dedicated top-level `keyVersion` so the CAS is a
> trivial atomic `findOneAndUpdate(... where keyVersion = expected)`.

---

## 2. Container `groupKeys` entries gain `groupEpoch` (BR-1)

Each container's stored per-group key entry records which group epoch its wrapped `CK` targets:

```ts
// db: GroupKeysEntry  (per container: thread/store/inbox/kvdb/stream)
interface GroupKeysEntry { group: types.group.GroupId; groupEpoch: number; keys: types.core.KeyEntry[]; }  // + groupEpoch
// api: GroupKeyEntrySet
interface GroupKeyEntrySet { group: types.group.GroupId; groupEpoch: number; keyId: types.core.KeyId; data: types.core.UserKeyData; }  // + groupEpoch
```

- The endpoint sets `groupEpoch` = the group epoch it wrapped `CK` to. The bridge stores it opaquely.
- It drives **client staleness detection** for lazy re-key: `container.groupKeys(g).groupEpoch <
  g.keyVersion` ⇒ stale ⇒ re-key on next write ([../endpoint_phase_two/03-lazy-rekey.md](../endpoint_phase_two/03-lazy-rekey.md)).
- **Required on input (Option A).** On the API (`GroupKeyEntrySet`) `groupEpoch` is **mandatory** and the
  bridge rejects a grant/re-key whose `groupEpoch` ≠ the group's current `keyVersion` (validator +
  `CloudKeyService.verifyGroupEpochCoverage`). Safe because the group feature is unreleased (no legacy
  group-grantee writes exist without it). The **DB** shape keeps `groupEpoch?` optional only so any pre-epoch
  *stored* entry still reads back (treated as the group's current epoch); it is never inspected on write —
  only new inserts are epoch-checked.

---

## 3. New error code `ROTATED_ALREADY` (BR-3)

Add to [../../src/api/AppException.ts](../../src/api/AppException.ts) (next free code in the group range, e.g.
`0x621C`). Returned by the rotation path when the CAS loses: it is **not** a plain failure — its payload
**carries the winning epoch's group key entry addressed to the caller** so the loser can adopt + retry
without another round trip (shape in [02-services-and-rpc.md](./02-services-and-rpc.md) §3).

`GROUP_VERSION_MISMATCH` keeps its Phase-1 meaning (stale `version` on a non-rotation `groupUpdate`).
`ROTATED_ALREADY` is specifically the **epoch CAS** loss on a rotation.

---

## 4. `generateNewGroupKey` request/result types (BR-2)

```ts
// ContextApiTypes.ts
interface GroupGenerateNewKeyModel {
  id: types.group.GroupId;
  groupPubKey: types.cloud.GroupPubKey;     // the NEW epoch identity pubkey
  data: types.group.GroupData;              // re-encrypted group data (new epoch committed in its DIO)
  keyId: types.core.KeyId;                  // new data-key id
  keys: types.cloud.KeyEntrySet[];          // data key wrapped to the CURRENT members (no membership change)
  expectedKeyVersion: number;               // CAS token
  confirmationTag?: types.core.Base64;      // optional key-confirmation tag (opaque, stored/served)
}
// result: OK | ROTATED_ALREADY{ winnerKeyEntry }   (see 02 §3)
```

`generateNewGroupKey` is a **rekey without a membership change** (compromise recovery / forced freshness). It
bumps `keyVersion`, rotates `groupPubKey`, re-wraps the data key to the unchanged member set.

---

## 5. Indexes & migration

- The Phase-1 index gap (`Migration0NN` creating the `group` collection + `groups.groupId` container indexes)
  should already be resolved (BR-0). Phase 2 adds **no new required index** — `keyVersion`/`keyHistory` are
  read with the group doc; `groupEpoch` lives inside the container `groupKeys` array (queried by `groupId`,
  already indexed).
- Add a migration that, if you choose top-level `keyVersion`, sets `keyVersion = 1` on existing group docs
  (optional — code can treat absent as 1, so a lazy default avoids a data migration entirely). Recommended:
  **lazy default in code, no migration**, to keep Phase 2 deploy zero-touch.

---

## 6. Summary
- Group: `+ keyVersion`, `+ keyHistory`. Container key entries: `+ groupEpoch`. New error: `ROTATED_ALREADY`.
  New types: `GroupGenerateNewKeyModel`.
- All additive, lazy-defaulted, backward-compatible. The bridge stores epochs and tags; it does not interpret
  key material. Enforcement logic is in [02-services-and-rpc.md](./02-services-and-rpc.md).
