# Bridge Phase 2 — API Reference for Endpoint Developers

This document lists every new API surface introduced in Phase 2. It is the authoritative reference for
endpoint developers calling the bridge.

---

## 1. New & changed RPC methods

### 1.1 `context.groupGenerateNewKey` *(new)*

Rotates the group's epoch keypair atomically (CAS on `keyVersion`).

```
context.groupGenerateNewKey({
    id:                GroupId,
    groupPubKey:       Base58 string   // new epoch public key
    data:              Base64 blob     // opaque DIO (must commit new keyVersion inside)
    keyId:             KeyId,
    keys:              KeyEntrySet[],  // user-encrypted copies of new epoch key — all current members
    expectedKeyVersion: number,        // CAS guard — must equal group.keyVersion on the bridge
    confirmationTag?:  Base64,         // optional; stored and served opaquely
}) → "OK"
```

**Errors**

| Code | Name | When |
|------|------|------|
| `0x621C` | `ROTATED_ALREADY` | Another request won the CAS race. Response body carries `{keyVersion, groupPubKey, winnerKeyEntry}` so the caller can adopt the winner and retry without an extra round-trip. |
| `0x621D` | `GROUP_ROTATION_RATE_LIMIT` | More than 10 rotations per (group, user) in the last hour. |

---

### 1.2 `context.groupUpdate` — new optional fields

Two new optional fields extend the existing request model.

```ts
{
    ...existing fields...
    expectedKeyVersion?: number   // if present, triggers CAS rotation path
    confirmationTag?:    Base64   // stored/served opaquely
}
```

When `expectedKeyVersion` is supplied, `groupUpdate` follows the same CAS path as `groupGenerateNewKey`
(rate-limit enforced, `ROTATED_ALREADY` possible). Omit it for normal (non-rotation) updates.

---

### 1.3 `{module}.{module}RotateKeys` *(new — ×5 modules)*

Each container module now has a dedicated key-rotation RPC.  Its purpose is to let any **member** (not just a
manager) re-encrypt existing container keys for the current epoch without touching data, membership, or policy.

| Module | Method name |
|--------|-------------|
| Thread | `thread.threadRotateKeys` |
| Store  | `store.storeRotateKeys` |
| Inbox  | `inbox.inboxRotateKeys` |
| Kvdb   | `kvdb.kvdbRotateKeys` |
| Stream | `stream.streamRoomRotateKeys` |

**Request shape (thread example; all 5 are identical in structure)**

```
thread.threadRotateKeys({
    id:        ThreadId,
    keyId:     KeyId,             // new key identifier
    keys:      KeyEntrySet[],     // user-encrypted key material for all current members
    groupKeys?: GroupKeyEntrySet[], // group-encrypted key material (if container has group grantees)
    version:   ThreadVersion,     // optimistic-lock guard (same as threadUpdate)
    force:     boolean,           // skip version check when true
}) → "OK"
```

**What it does NOT accept** — `data`, `users`, `managers`, `policy`, `resourceId` are intentionally absent.
The bridge preserves the old values for all of these fields unchanged.

**Default policy** — `"user"` (any member may call; see §3 for policy details).

---

## 2. Changed model fields returned by existing RPCs

### 2.1 `GroupInfo` (returned by `groupGet` / `groupList`)

Two new fields are now present on every group:

```ts
interface GroupInfo {
    ...existing fields...
    keyVersion: number                   // current epoch counter; 0 = no rotation yet, 1 = genesis or first rotation
    keyHistory: GroupPubKeyAtEpoch[]     // ordered list of past epoch pubkeys
}
```

```ts
interface GroupPubKeyAtEpoch {
    keyVersion: number    // epoch at which this pubkey was the current key
    groupPubKey: string   // Base58 pubkey
}
```

`keyVersion` starts at `0` for groups created before Phase 2 was deployed (treat as "no epoch yet").
After the first `generateNewGroupKey` or rotation-path `groupUpdate`, it becomes `1` and increments
monotonically.

---

### 2.2 `GroupHistoryEntryInfo` (inside `GroupInfo.history`)

```ts
interface GroupHistoryEntryInfo {
    ...existing fields...
    confirmationTag?: Base64   // present only when the caller supplied one during rotation
}
```

---

### 2.3 `GroupKeysEntry` / `GroupKeyEntrySet` (container `groupKeys`)

A new optional field appears on individual key entries:

```ts
interface GroupKeysEntry {
    ...existing fields...
    groupEpoch?: number   // epoch of the group key used when this container entry was written
}
```

The bridge validates `groupEpoch` on container re-key: if you supply a `groupKeys` entry for a group, its
`groupEpoch` must match the group's current `keyVersion`. Omit `groupEpoch` (or set it to `undefined`) when
the group has `keyVersion === 0` (not yet rotated) — the bridge skips the check.

---

### 2.4 `groups[].groupEpoch` (on every container payload)

Every user-facing container payload — `threadGet`/`threadList`, and the same for store, inbox, kvdb and stream
room, plus the per-recipient container in a WebSocket notification — serves its grants as:

```ts
groups: {groupId: string, role: "user"|"manager", groupEpoch?: number}[]
```

`groupEpoch` is the epoch at which **this group's wrap of the container's current `keyId`** was made. Compare it
with the group's current `keyVersion` and you have the re-key decision, without a `groupGet` per grant:

```
rekeyNeeded(grant) := grant.groupEpoch !== undefined && grant.groupEpoch < currentEpochOf(grant.groupId)
```

with a group absent from wherever you read epochs counting as `1`. That is exactly the rule the bridge applies
before accepting an item write, so a client following it is never refused by surprise
(`CONTAINER_GROUP_EPOCH_OUTDATED`).

- **`0` vs absent.** `0` is a wrap that declared no epoch (a Phase-1 wrap — behind any rotation). The field is
  absent when the current key is not wrapped to that group at all: nothing is read through it at the current key,
  so there is nothing to re-key for it either.
- **Not narrowed** to the caller's own groups, unlike `groupKeys`: the manager doing the re-key is often a member
  of none of the granted groups.
- **Output only.** On writes, grants are `{groupId, role}` and the epoch travels — mandatory — in
  `groupKeys[].groupEpoch`. Do not echo a served `groups` array back into `update*`/`rotateKeys`; strip the field.
- **Costs the server nothing.** It is read off the container document, which the request already loaded. The
  bridge performs no group lookup on a container read; the comparison is the client's, against epochs it can
  verify cryptographically rather than a boolean it has to trust.

Where to get the current epochs: `groupUpdated` events carry `keyVersion` (free, but only for members of the
group — see `GroupNotificationService`), and §2.5 resolves many groups in one call.

---

### 2.5 `groupList` filtered by id (the follow-up call)

`groups[].groupEpoch` says what a container was wrapped at; the decision needs the groups' current epoch, and a
re-key then needs their `groupPubKey`. `groupList` takes the same `query` every container listing takes, and
`#id` addresses the group id:

```json
{"contextId": "…", "query": {"#id": {"$in": ["g1", "g2"]}}, "skip": 0, "limit": 100, "sortOrder": "asc"}
```

One request returns a `GroupSummary` per id, carrying `groupPubKey` and `keyVersion` — no `groupGet` per
grant, and no full group state. Notes:

- `limit` caps at 100, so that is the most ids one call resolves.
- An id that does not exist, or belongs to another context, is simply absent — the `contextId` filter is
  applied before the query. A client's id list comes from a container payload that may be out of date, so this
  is a skip, not an error.
- Results are ordered by `sortBy` (`createDate`/`lastModificationDate`), not by the order of the id list.
- Only whitelisted `#`-prefixed fields are queryable (`MongoQueryConverter`); a bare key resolves against
  `data.publicMetaObject`, which is meaningless for a group.
- `groupGet` remains the only call serving `keyHistory`, tree state and history — and it requires membership in
  the group under the default `group.get: "user"` policy, while `groupList` is open under `group.listAll: "all"`.

---

## 3. Policy changes

### 3.1 New `rotateKeys` policy entry

All five container policy types (`ContainerWithoutItemPolicy` and `ContainerPolicy`) now carry:

```ts
rotateKeys?: PolicyEntry
```

### 3.2 Default context policy

| Container | `update` default | `rotateKeys` default |
|-----------|-----------------|----------------------|
| thread    | `"manager"`     | `"user"` |
| store     | `"manager"`     | `"user"` |
| inbox     | `"manager"`     | `"user"` |
| stream    | `"manager"`     | `"user"` |
| kvdb      | `"manager"`     | `"user"` |

**Implication**: after Phase 2, regular members can call `rotateKeys` without manager privileges.
`update*` continues to require manager access by default and remains the only way to change
data, membership, or policy.

---

## 4. Error codes (new)

| Hex code | Name | Meaning |
|----------|------|---------|
| `0x621C` | `ROTATED_ALREADY` | The group's `keyVersion` has already been advanced by a concurrent request. The response body carries `{keyVersion, groupPubKey, winnerKeyEntry}`. |
| `0x621D` | `GROUP_ROTATION_RATE_LIMIT` | Key rotation rate limit exceeded (10 per (group, user) per hour). |

---

## 5. Usage guide

### 5.1 Rotating a group key (endpoint-initiated)

1. Fetch the current group to read `keyVersion` (call `groupGet`).
2. Mint a fresh epoch keypair client-side.
3. Encrypt the new private key for every current member.
4. Call `generateNewGroupKey` with `expectedKeyVersion = group.keyVersion`.
5. **On `ROTATED_ALREADY`**: read `winnerKeyEntry` from the error body, adopt the winner's pubkey, update your
   local epoch map, and retry your operation using the winner's `keyVersion + 1` as the new
   `expectedKeyVersion`.
6. **On `GROUP_ROTATION_RATE_LIMIT`**: back off and surface the error to the user.

### 5.2 Rotating container keys after group membership change

When a group member is removed (handled by `groupUpdate`), any containers that list the group as a grantee
must be re-keyed so the removed member can no longer decrypt new content.

1. After a `groupUpdate` that bumps `keyVersion`, enumerate all containers that have the group in
   `groupKeys`. Which of them actually need it you can tell from the container itself: compare each grant's
   `groupEpoch` (§2.4) with the new `keyVersion` — no `groupGet` per grant.
2. For each container: call `{module}RotateKeys` with a fresh `keyId` and new `keys` for all direct
   members.  When re-supplying `groupKeys`, set `groupEpoch` to the group's new `keyVersion`. Every currently
   granted group needs an entry at the new `keyId`, not only the ones that were behind.
3. The bridge validates that `groupEpoch` matches; it rejects stale entries.

### 5.3 `update*` vs `rotateKeys`

| Task | Call |
|------|------|
| Change container data / add / remove members / change policy | `update*` (manager only by default) |
| Re-encrypt keys for current members (e.g. after group epoch bump) | `rotateKeys` (any member by default) |

`rotateKeys` intentionally cannot change membership or data.  This design ensures that lazy re-key —
triggered by any member noticing a stale group epoch — cannot be used to alter container content or access.

---

## 6. Backward compatibility

- Groups created before Phase 2 have `keyVersion === 0` and no `keyHistory`.  The bridge treats the absence
  of `keyVersion` in the database document as `0`.
- Container `groupKeys` entries without `groupEpoch` skip the epoch coverage check (the bridge treats the
  absence as "current epoch" for backward compatibility).
- `generateNewGroupKey` and the CAS path of `groupUpdate` both accept `expectedKeyVersion = 0` to rotate a
  legacy group for the first time (resulting in `keyVersion = 1`).
