# 02 — Services, RPC & enforcement (Phase 2)

How the bridge orchestrates epochs, concurrency, coverage, and rate-limiting. None of this verifies crypto —
it is server-side concurrency/coverage/abuse control on top of opaque blobs.

---

## 1. Epoch bump points (BR-1)

The bridge increments `keyVersion` (and appends to `keyHistory`) on **exactly one op: `generateNewGroupKey`**
— the dedicated rotation method. `groupUpdate` (membership/metadata, including removals) **never** bumps the
epoch; it must keep the current `groupPubKey`.

> **Decision (decoupled rotation).** Rotation is intentionally *not* triggered by `groupUpdate` removals.
> Removing a member and rotating the key are two separate operations (`groupUpdate` then
> `generateNewGroupKey`), so a caller can be allowed to rotate keys without being allowed to add/remove members
> (and vice-versa). To exclude a removed member from container content (forward secrecy), the manager follows a
> removal with a `generateNewGroupKey`. See [03-flows.md](./03-flows.md) §2.

---

## 2. `context.generateNewGroupKey` (BR-2)

New `@ApiMethod` on `ContextApi` + `GroupService.generateNewGroupKey`. Order of operations (in a transaction):

1. `validateContextSessionAndGetCloudUser()`; load `oldGroup` → `GROUP_DOES_NOT_EXIST`.
2. ACL `context/groupUpdate` (manager-only); **rate-limit** check (§4).
3. **CAS guard:** `if (oldGroup.keyVersion !== expectedKeyVersion) → ROTATED_ALREADY` (with winner envelope,
   §3).
4. Coverage: `cloudKeyService.checkKeysAndClients(...)` over the **unchanged** member set for the new `keyId`
   (members must all be re-covered).
5. `groupRepository.generateNewGroupKey(oldGroup, modifier, newGroupPubKey, data, keyId, keys, confirmationTag)`
   — atomic update: append a `history` entry (stores opaque `data`), set `groupPubKey = newGroupPubKey`,
   `keyVersion = oldGroup.keyVersion + 1`, push old pub to `keyHistory`.
6. Notify members (`groupUpdated`).

No membership change; the member sets are copied from `oldGroup`. The epoch is committed in the endpoint DIO
inside `data` (the bridge just stores it).

---

## 3. Optimistic CAS + `ROTATED_ALREADY` (BR-3)

Make the epoch the concurrency token on the **rotation path** — i.e. **`generateNewGroupKey` only**
(`groupUpdate` does not rotate, so it does not use the epoch CAS):

```
GroupRepository.casRotate(id, expectedKeyVersion, newDoc):
   res = collection.findOneAndUpdate(
            { _id: id, keyVersion: expectedKeyVersion },        // atomic compare
            { $set: {... newDoc ...}, $inc: { keyVersion: 1 }, $push: { keyHistory: oldPub } },
            { returnNewDocument: true })
   if (res == null) return MISS                                  // someone else rotated first
   return res
```

On `MISS`, the service responds **`ROTATED_ALREADY`** whose payload includes the **winning epoch's group key
entry addressed to the caller**:

```ts
interface RotatedAlreadyData {
  keyVersion: number;                 // the winner's new epoch
  groupPubKey: types.cloud.GroupPubKey;
  winnerKeyEntry: types.cloud.KeyEntry;  // the winner's `keys[]` entry FOR THE CALLER (wrapped to caller's pubkey)
}
```

- The winner's `keys[]` (submitted with the winning rotation) already contains one entry per member; the
  bridge simply selects the caller's entry and returns it in the rejection.
- **Safety:** that entry is wrapped to the caller's pubkey and integrity-protected by the *winner's* DIO — a
  malicious bridge can neither forge nor substitute it (the endpoint verifies it on adopt). The bridge is just
  routing a blob it already holds.
- The loser adopts the new epoch key from the envelope and retries its original op — no extra round trip
  ([../endpoint_phase_two/02-rotation-cas-confirmation.md](../endpoint_phase_two/02-rotation-cas-confirmation.md)).

---

## 4. Rate-limit + manager-only rotation (BR-4)

- **Manager-only:** rotations already require `context/groupUpdate` ACL — keep it; reject member-role callers.
- **Rate-limit:** throttle rotations per `(groupId, actorUserId)` (e.g. token-bucket; reuse any existing
  bridge rate-limit middleware, otherwise a small per-group counter with a time window). Reject with a
  rate-limit error (or `ACCESS_DENIED` with a reason) when exceeded.
- **No client-arbitrary rotation:** the bridge bumps epochs only on hard roster changes (removal) or explicit
  `generateNewGroupKey` — never as an implicit side effect a member could spam. This defeats the rotation-spam
  DoS ([../group-mls-lite-plan.md](../group-mls-lite-plan.md) §5).

---

## 5. Per-epoch coverage on container re-key (BR-5)

Every container key-write that touches group grantees (`*Create`, `*Update`, and the dedicated `*RotateKey`)
must verify coverage **against the groups' current epoch**:

- `CloudKeyService.checkGroupKeysAndGrantees` / `verifyGroupEpochCoverage`: for each grantee group `g`, the
  submitted `groupKeys` entry must **carry `groupEpoch`** (mandatory — Option A) and it must `== g.keyVersion`
  (the **current** epoch), and there must be exactly one entry per grantee for the new `keyId` (set-equality,
  as Phase 1) — no missing entry, no extra, **no missing `groupEpoch`**, no stale epoch.
- This prevents a malicious/buggy member from "re-keying" a container to an **old** group epoch (which a
  removed member could still read), and turns a rotation race into a clean retry. Any violation ⇒
  `INVALID_PARAMS`.

The bridge fetches each grantee group's current `keyVersion` to compare. (One extra group read per re-key with
group grantees; index already covers it.)

---

## 6. `groupUpdate` (unchanged by Phase 2 — membership/metadata only)

`groupUpdate` is **not** a rotation path. Phase 2 adds exactly one constraint to the Phase-1 method: it must
**reject a `groupPubKey` change** (`INVALID_PARAMS` — "use generateNewGroupKey to rotate the key"), so it can
never bump the epoch. It still uses the `version` (= `history.length`) optimistic-concurrency check, may rotate
the **data** key (`keyId`) as part of a removal, and carries `keyVersion`/`keyHistory` forward unchanged. No
epoch CAS, no `ROTATED_ALREADY`, no rotation rate-limit on this path.

> Note: `version` (= `history.length`) and `keyVersion` (= epoch) are **different** counters. `version`
> increments on *every* update (`groupUpdate` **and** `generateNewGroupKey`); `keyVersion` increments **only**
> on `generateNewGroupKey`. `version` = general last-writer-wins; `keyVersion` = the rotation CAS + epoch
> tagging.

---

## 7. IOC / wiring
`generateNewGroupKey` rides on the existing `ContextApi`/`GroupService` wiring (no new IOC service). Add the
validator entry (`ContextApiValidator`) and the client method (`ContextApiClient`). Rate-limit state can live
in the existing rate-limit subsystem or a small in-memory/Redis counter keyed by `(groupId, actor)`.
