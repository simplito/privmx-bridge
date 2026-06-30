# Group API — reference, flows & example payloads

Practical reference for integrating the **privmx-endpoint** client against the bridge's Group API
(`context.group*`) and group-as-grantee on containers. Reflects the **current implemented bridge** (Phase 1 +
Phase 2: epochs, CAS, `generateNewGroupKey`, rate-limit, per-epoch coverage).

Design background: [plan/](./plan/) (contract/architecture), [endpoint_phase_one/](./endpoint_phase_one/) and
[endpoint_phase_two/](./endpoint_phase_two/) (client design). This doc is the "wire format + flows" companion.

---

## 0. How to read this

**Transport.** Methods are RPC calls on `ContextApi`; the wire method name is `context.<method>` and the
**params** object is the model shown below. The endpoint's RPC layer wraps it in the standard PrivMX server
request envelope; only `method` + `params` (request) and the result (response) are shown here.

**Security model (important).** The bridge **stores group data opaquely and verifies nothing**. The membership
proof — the author's signature, the member set, and a chain link to the prior version — is committed **inside
the opaque `data` blob** as the endpoint's `DataIntegrityObject` (DIO) and is **verified client-side** on read.
So `data` (and `keys`/`groupKeys` `data` fields) are opaque base64 to the bridge; the endpoint produces and
verifies them. The bridge enforces only: ACL, key-coverage (set-equality + per-epoch), the `version`/
`keyVersion` optimistic-concurrency checks, rotation rate-limit, and `GROUP_IN_USE`.

**Placeholder legend** (values are illustrative, truncated with `…`):
- `groupPubKey`, `userPubKey` — base58 ECC public keys, e.g. `"7Hk9…Qm2"`.
- `keyId` — 16-byte hex, e.g. `"3fa9c1d8e07b46a2bb90f5e1c2d3a4b5"`.
- `data`, key-entry `data`, `confirmationTag` — **opaque base64** (carry encrypted content / DIO / wrapped
  keys), e.g. `"eyJ2Ijo1…"`. The bridge never parses them.

---

## 1. Shared types (with example values)

```jsonc
// KeyEntrySet — the group data key wrapped to one member (group's own `keys[]`)
{ "user": "alice", "keyId": "3fa9…a4b5", "data": "BASE64_wrapped_to_alice_userPubKey" }

// GroupKeyEntrySet — a container key wrapped to a GROUP (container's `groupKeys[]`), epoch-tagged (Phase 2)
{ "group": "group_5f3a", "groupEpoch": 1, "keyId": "7c1e…90ab", "data": "BASE64_wrapped_to_groupPubKey" }

// GroupGrant — a group granted access to a container, with its role there
{ "groupId": "group_5f3a", "role": "user" }            // role: "user" | "manager"

// GroupPubKeyAtEpoch — an entry of the group's keyHistory
{ "keyVersion": 1, "groupPubKey": "7Hk9…Qm2" }

// GroupHistoryEntryInfo — one version record served in GroupInfo.history (no signatures here; the proof is in `data`)
{ "keyId": "3fa9…a4b5", "groupPubKey": "7Hk9…Qm2", "users": ["alice","bob"], "managers": ["alice"],
  "created": 1719500000000, "author": "alice", "confirmationTag": "BASE64…" /* optional */ }
```

---

## 2. RPC methods

### 2.1 `context.groupCreate` → `{ groupId }`
Creates a group. The endpoint generates the group identity keypair (`groupPubKey`) and data key (`keyId`),
builds the DIO-signed `data` (commits members + genesis chain link), and wraps the data key to each member.

```jsonc
// → context.groupCreate  (params)
{
  "contextId": "context_ab12",
  "resourceId": "b3f1c0de-0000-4a11-9c22-aa01bb02cc03",   // optional, client idempotency id
  "type": "messaging",                                     // optional
  "groupPubKey": "7Hk9…Qm2",
  "users": ["alice", "bob"],
  "managers": ["alice"],
  "data": "eyJ2Ijo1…",                                     // opaque: DIO{publicMeta, privateMeta, groupPrivKey, membership}
  "keyId": "3fa9c1d8e07b46a2bb90f5e1c2d3a4b5",
  "keys": [
    { "user": "alice", "keyId": "3fa9…a4b5", "data": "BASE64_to_alice" },
    { "user": "bob",   "keyId": "3fa9…a4b5", "data": "BASE64_to_bob" }
  ],
  "policy": {}                                             // optional ContainerPolicy
}
// ← result
{ "groupId": "group_5f3a" }
```
**Errors:** `ACCESS_DENIED`, `DUPLICATE_RESOURCE_ID`, `INVALID_PARAMS`, `INVALID_KEY_ID`, `USER_DOESNT_EXIST`.

### 2.2 `context.groupUpdate` → `"OK"`
Full-replace of **membership/metadata only** — add/remove members, change `data`/`policy`, rotate the group's
**data key** (`keyId`). Optimistic-concurrency on `version` (= `history.length`).

It does **not** rotate the group **identity key** (`groupPubKey`/epoch): `groupPubKey` **must equal the
group's current value** or the call is rejected (`INVALID_PARAMS`). Key rotation is a separate, narrowly-scoped
operation — [`context.groupGenerateNewKey`](#23-contextgroupgeneratenewkey--ok) (§2.3) — which **cannot**
add/remove members. This split keeps "manage members" and "rotate keys" as distinct capabilities.

```jsonc
// → context.groupUpdate  (params) — here: remove "bob" (membership change only; identity key unchanged)
{
  "id": "group_5f3a",
  "groupPubKey": "7Hk9…Qm2",           // MUST equal the current groupPubKey (update cannot rotate it)
  "users": ["alice"],
  "managers": ["alice"],
  "data": "eyJ2Ijoy…",                 // new DIO: members=[alice], prevEntryHash=<hash of prior version>
  "keyId": "8b2d…c4f1",                // new DATA-key id (so removed bob loses the group data key)
  "keys": [ { "user": "alice", "keyId": "8b2d…c4f1", "data": "BASE64_to_alice" } ],
  "version": 1,                        // expected current version (history length)
  "force": false,
  "policy": {}                         // optional
}
// ← result
"OK"
```
> To also exclude `bob` from containers the group grants into (forward secrecy), follow this with a
> `groupGenerateNewKey` to rotate the identity epoch (§2.3, §4-D).

**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED`, `GROUP_VERSION_MISMATCH` (stale `version`),
`INVALID_PARAMS` (incl. attempting to change `groupPubKey`), `INVALID_KEY_ID`, `USER_DOESNT_EXIST`.

### 2.3 `context.groupGenerateNewKey` → `"OK"`  (Phase 2)
**The dedicated — and only — key-rotation method.** Rotates the group identity key (new `groupPubKey`, bumps
`keyVersion` via an atomic CAS) and re-wraps the data key to the **unchanged** member set. It **cannot**
add/remove members (membership is `groupUpdate`'s job). Used for: forward secrecy after a removal, compromise
recovery, forced freshness, and lazy re-key. Optional `confirmationTag`.

```jsonc
// → context.groupGenerateNewKey  (params)
{
  "id": "group_5f3a",
  "groupPubKey": "4Ce8…Wd0",           // new epoch identity pubkey
  "data": "eyJ2Ijoz…",
  "keyId": "a1c7…2e9d",
  "keys": [
    { "user": "alice", "keyId": "a1c7…2e9d", "data": "BASE64_to_alice" },
    { "user": "bob",   "keyId": "a1c7…2e9d", "data": "BASE64_to_bob" }
  ],
  "expectedKeyVersion": 2,             // current epoch the caller saw; CAS token
  "confirmationTag": "BASE64_MAC"      // optional: MAC of the new key; recipients verify before adopting
}
// ← result
"OK"   // or ROTATED_ALREADY (§4-F)
```
**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED`, **`ROTATED_ALREADY`** (lost the epoch CAS — payload in
§4-F), **`GROUP_ROTATION_RATE_LIMIT`**, `INVALID_PARAMS`, `INVALID_KEY_ID`. (Rotation-specific errors live
here, not on `groupUpdate`.)

### 2.4 `context.groupGet` → `{ group: GroupInfo }`
Returns the group + full version history; the endpoint **verifies** before trusting (§4-B).

```jsonc
// → context.groupGet  (params)
{ "groupId": "group_5f3a", "type": "messaging" /* optional filter */ }
// ← result
{
  "group": {
    "id": "group_5f3a",
    "groupPubKey": "9Rt2…Lp7",          // current epoch pubkey
    "contextId": "context_ab12",
    "resourceId": "b3f1c0de-…-cc03",     // optional
    "type": "messaging",                 // optional
    "createDate": 1719500000000,
    "creator": "alice",
    "lastModificationDate": 1719500500000,
    "lastModifier": "alice",
    "data": [                            // {keyId, data} per version — the DIO blobs to replay/verify
      { "keyId": "3fa9…a4b5", "data": "eyJ2Ijo1…" },
      { "keyId": "8b2d…c4f1", "data": "eyJ2Ijoy…" }
    ],
    "users": ["alice"],
    "managers": ["alice"],
    "keys": [ { "keyId": "8b2d…c4f1", "data": "BASE64_to_caller" } ],  // filtered to the requesting user
    "version": 2,                        // = history.length
    "keyVersion": 2,                     // current epoch (CAS token)
    "keyHistory": [ { "keyVersion": 1, "groupPubKey": "7Hk9…Qm2" } ],  // past epoch pubkeys
    "policy": {},
    "history": [
      { "keyId": "3fa9…a4b5", "groupPubKey": "7Hk9…Qm2", "users": ["alice","bob"], "managers": ["alice"],
        "created": 1719500000000, "author": "alice" },
      { "keyId": "8b2d…c4f1", "groupPubKey": "9Rt2…Lp7", "users": ["alice"], "managers": ["alice"],
        "created": 1719500500000, "author": "alice" }
    ]
  }
}
```
**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED`.

### 2.5 `context.groupList` → `{ groups: GroupInfo[], count }`
```jsonc
// → context.groupList  (params)
{ "contextId": "context_ab12", "skip": 0, "limit": 50, "sortOrder": "asc", "sortBy": "createDate" }
// ← result
{ "groups": [ /* GroupInfo … */ ], "count": 7 }
```
**Errors:** `ACCESS_DENIED`. `sortBy` ∈ `{"createDate","lastModificationDate"}`.

### 2.6 `context.groupDelete` → `"OK"`
```jsonc
// → context.groupDelete  (params)
{ "groupId": "group_5f3a" }
// ← result
"OK"
```
**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED`, **`GROUP_IN_USE`** (still a grantee of a container).

---

## 3. Group-as-grantee on containers (thread/store/inbox/kvdb/stream)

Each container `*Create`/`*Update` accepts two **optional** fields. Shown for `thread.threadCreate`; identical
shape on the other four. The container key (`keyId`) is wrapped once to each grantee group's `groupPubKey`.

```jsonc
// → thread.threadCreate  (params, excerpt)
{
  "contextId": "context_ab12",
  "keyId": "7c1e…90ab",
  "data": "BASE64_thread_data",
  "users": ["alice"],                                   // direct users (each with a key entry below)
  "managers": ["alice"],
  "keys": [ { "user": "alice", "keyId": "7c1e…90ab", "data": "BASE64_to_alice" } ],
  "groups":    [ { "groupId": "group_5f3a", "role": "user" } ],                       // NEW
  "groupKeys": [ { "group": "group_5f3a", "groupEpoch": 2, "keyId": "7c1e…90ab",
                   "data": "BASE64_CK_wrapped_to_groupPubKey" } ]                     // NEW
}
```
On read, `ThreadInfo` echoes `groups` and `groupKeys` (the latter is the DB shape
`{group, groupEpoch?, keys:[{keyId,data}]}`). Coverage rules the bridge enforces:
- **set-equality**: exactly the listed grantee groups are covered for `keyId` (no missing → anti-ghosting, no
  extra).
- **per-epoch (Phase 2)**: `groupEpoch` is **required** on every group key entry and must equal the group's
  **current** `keyVersion` — a missing `groupEpoch` or a stale one → `INVALID_PARAMS`. (This is mandatory, not
  opt-in: it prevents granting/re-keying to a stale epoch and turns a rotation race into a clean error to
  re-fetch + retry. Enforced both by the validator and `CloudKeyService`.)

---

## 4. Flows (with payloads)

A coherent story: Alice creates a group with Bob, grants it to a thread, removes Bob (rotation), and a writer
lazily re-keys the thread. `→` = endpoint→bridge request, `←` = response, `⚡` = event.

### A. Create a group
```
→ context.groupCreate { contextId, groupPubKey:"7Hk9…Qm2", users:["alice","bob"], managers:["alice"],
                        data:"eyJ2Ijo1…"(DIO genesis), keyId:"3fa9…", keys:[→alice,→bob] }
← { groupId: "group_5f3a" }
⚡ groupCreated  (channel "context")  → to alice, bob
```
Genesis `data` DIO commits `membership:{users:["alice","bob"], managers:["alice"], groupPubKey:"7Hk9…Qm2",
keyId:"3fa9…", keyVersion:1, prevEntryHash:null}`, signed by alice.

### B. Get a group and verify it (client-side)
```
→ context.groupGet { groupId:"group_5f3a" }
← { group: GroupInfo (see §2.4) }
```
Endpoint then, over `data[]` (DIO blobs) + `history[]`:
1. verify each version's DIO signature; 2. check `membership[i].prevEntryHash == sha256(data[i-1])` (chain);
3. check each signer was a manager in the prior verified state; 4. check DIO-committed members ==
`history[i].users/managers` and `keyVersion` == bridge `keyVersion`; 5. run `UserVerifier` on every signer.
Any failure ⇒ tamper error. (Full algo: [endpoint_phase_one/03-verification.md](./endpoint_phase_one/03-verification.md).)

### C. Add a member (full replace, **no** epoch bump)
Adding never removes anyone, so it is not a rotation; `keyVersion` stays.
```
→ context.groupGet { groupId } ; verify ; head version = 1
→ context.groupUpdate {
     id:"group_5f3a", groupPubKey:"7Hk9…Qm2"(unchanged), users:["alice","bob","carol"], managers:["alice"],
     data:"eyJ2Ijox…"(new DIO, prevEntryHash=hash(v1)), keyId:"3fa9…"(reuse), 
     keys:[→alice,→bob,→carol](full set), version:1, force:false }
← "OK"
⚡ groupUpdated → alice, bob, carol
```
Carol can now read everything the group grants into (the container keys are wrapped to the unchanged
`groupPubKey`). Cost: full key set re-sent (O(members)).

### D. Remove a member — TWO steps (membership, then rotation)
Membership and key-rotation are **separate operations**. Removing Bob is a `groupUpdate`; excluding him from
future container content is a follow-up `groupGenerateNewKey`.

**D1 — drop the member (membership only; identity key unchanged):**
```
→ context.groupGet { groupId } ; verify ; head version = 2, keyVersion = 1
→ context.groupUpdate {
     id:"group_5f3a", groupPubKey:"7Hk9…Qm2"(UNCHANGED), users:["alice","carol"], managers:["alice"],
     data:"eyJ2IjenA…"(new DIO, prevEntryHash=hash(v2)),
     keyId:"8b2d…"(new DATA key → bob loses group data), keys:[→alice,→carol](remaining only),
     version:2, force:false }
← "OK"           // keyVersion UNCHANGED (still 1) — updateGroup never rotates the identity
⚡ groupUpdated → alice, carol, AND bob (bob's client drops state)
```
Bob is **server-blocked immediately**. But he may still hold the group identity private key, so to lock him
out of containers (forward secrecy) the manager rotates:

**D2 — rotate the identity epoch (no membership change):**
```
→ context.groupGenerateNewKey {
     id:"group_5f3a", groupPubKey:"9Rt2…Lp7"(fresh epoch), data:"…", keyId:"c1f0…",
     keys:[→alice,→carol](remaining), expectedKeyVersion:1 }
← "OK"           // bridge CAS: keyVersion 1→2 ; pushes {keyVersion:1, groupPubKey:"7Hk9…Qm2"} to keyHistory
⚡ groupUpdated → alice, carol
```
Containers the group grants into are then re-keyed **lazily** on next write (§I).

### E. `generateNewGroupKey` (compromise recovery, no membership change)
```
→ context.groupGet { groupId } ; keyVersion = 2
→ context.groupGenerateNewKey {
     id:"group_5f3a", groupPubKey:"4Ce8…Wd0", data:"eyJ2Ijfg…",
     keyId:"a1c7…", keys:[→alice,→carol](current members), expectedKeyVersion:2,
     confirmationTag:"BASE64_MAC" }
← "OK"           // keyVersion 2→3
⚡ groupUpdated → alice, carol
```

### F. Concurrent rotation → `ROTATED_ALREADY` + retry
Two managers call `groupGenerateNewKey` from `keyVersion:2` at once; the CAS lets one win.
```
A → context.groupGenerateNewKey { …, expectedKeyVersion:2 }   ← "OK"        (A wins; keyVersion→3)
B → context.groupGenerateNewKey { …, expectedKeyVersion:2 }   ← error ROTATED_ALREADY:
{
  "error": {
    "code": 25116,                       // 0x621C
    "message": "Group key was already rotated by a concurrent request",
    "data": {                            // RotatedAlreadyData
      "keyVersion": 3,
      "groupPubKey": "<A's new epoch pubkey>",
      "winnerKeyEntry": { "keyId": "<A's new keyId>", "data": "BASE64_wrapped_to_B" }
    }
  }
}
```
B verifies `winnerKeyEntry` (signed by A, wrapped to B), adopts epoch 3, and **retries its original op** — no
extra round trip for the key. (If B was the one being removed, `winnerKeyEntry.data` is empty — B simply has no
access, which is correct.)

### G. Grant the group to a thread
```
→ context.groupGet { group_5f3a } ; verify ; current keyVersion = 3, groupPubKey = "4Ce8…Wd0"
→ thread.threadCreate { …, keyId:"7c1e…", keys:[→alice],
     groups:[{groupId:"group_5f3a", role:"user"}],
     groupKeys:[{group:"group_5f3a", groupEpoch:3, keyId:"7c1e…", data:"CK_wrapped_to_4Ce8…Wd0"}] }
← { threadId: "thread_77c0" }
```
Bridge coverage check: exactly `group_5f3a` covered for `7c1e…`, and `groupEpoch:3 == current keyVersion:3`.

### H. Read the thread via group membership (key resolution)
A group member who is **not** a direct user of the thread:
```
→ thread.threadGet { threadId:"thread_77c0" }
← ThreadInfo { …, groups:[…], groupKeys:[{group:"group_5f3a", groupEpoch:3, keys:[{keyId:"7c1e…", data:…}]}] }
   // endpoint resolves:  my group data-key entry → group `data` → GroupPriv(epoch 3)
   //                     → ECIES-decrypt(groupKeys[group_5f3a].data, GroupPriv) → CK → decrypt thread
```

### I. Lazy re-key on write (forward secrecy) — Phase 2 endpoint
Forward secrecy is **opt-in, lazy, best-effort**, controlled by a container policy flag
**`policy.forwardSecrecy`** (a `PolicyBooleanEntry`: `"yes" | "no" | "inherit" | "default"`, settable per
container and inheritable from the context). When `"yes"`, a forward-secrecy-aware client re-keys the container
on the next write after a grantee group's epoch advances. The **bridge only stores/serves the flag** — it does
**not** force re-key (best-effort); the endpoint reads it and acts. (New clients set `forwardSecrecy:"yes"` on
create silently.)

After Bob's removal (group epoch advanced), the next write to `thread_77c0` (whose `policy.forwardSecrecy` is
`"yes"`) notices its stored `groupEpoch (2) < group.keyVersion (3)` and re-keys via the **dedicated**
`thread.threadRotateKey` (key rotation only — no membership change; the counterpart of `generateNewGroupKey`):
```
→ context.groupGet { group_5f3a } ; current keyVersion = 3
→ thread.threadRotateKey {
     id:"thread_77c0", keyId:"d4e5…"(new CK), keys:[→alice (current direct users)],
     groupKeys:[{group:"group_5f3a", groupEpoch:3, keyId:"d4e5…", data:"newCK_wrapped_to_4Ce8…Wd0"}],
     version:<current>, force:false }
← "OK"      // bridge: re-wraps to CURRENT users + grantee groups; per-epoch coverage groupEpoch:3 == keyVersion:3 ✓
```
Bob (excluded from epoch 3) cannot read content written after this. Old content keeps the old `CK`.

> **`thread.threadRotateKey`** rotates only the container content key (new `keyId` + `keys`/`groupKeys` for the
> **current** members/grantees); it **cannot** add/remove users or groups (that's `threadUpdate`). Request:
> `{ id, keyId, keys, groupKeys?, version, force }`; reuses the `thread/threadUpdate` ACL; errors:
> `THREAD_DOES_NOT_EXIST`, `ACCESS_DENIED` (incl. stale `version`), `INVALID_PARAMS` (coverage / stale
> `groupEpoch`), `INVALID_KEY_ID`. *(Implemented for **thread**; the other containers — store/inbox/kvdb/stream
> — will get the same `*RotateKey` method as a follow-up; until then their re-key uses `*Update`.)*

### J. Delete the group
```
→ context.groupDelete { groupId:"group_5f3a" }
← error GROUP_IN_USE   // because thread_77c0 still grants to it
   // remove the grant first:
→ thread.threadUpdate { …, groups:[], groupKeys:[] , keys:[…direct users…] }
→ context.groupDelete { groupId:"group_5f3a" }
← "OK"
⚡ groupDeleted → former members
```

---

## 5. Error codes

| Code | Hex | Dec | When |
|------|-----|-----|------|
| `GROUP_DOES_NOT_EXIST` | `0x6219` | 25113 | group id not found in context |
| `GROUP_IN_USE` | `0x621A` | 25114 | delete blocked: still a container grantee |
| `GROUP_VERSION_MISMATCH` | `0x621B` | 25115 | stale `version` without `force` (optimistic concurrency) |
| `ROTATED_ALREADY` | `0x621C` | 25116 | lost the epoch `keyVersion` CAS; payload carries the winner envelope |
| `GROUP_ROTATION_RATE_LIMIT` | `0x621D` | 25117 | too many rotations per `(group, user)` (10/hour, cross-worker) |
| `ACCESS_DENIED` | — | — | ACL/policy refusal (`context/group*`) |
| `INVALID_PARAMS` | — | — | malformed input / coverage mismatch / **stale `groupEpoch`** / duplicate ids |
| `INVALID_KEY_ID` | — | — | key entry references an unavailable `keyId` |
| `DUPLICATE_RESOURCE_ID` | — | — | `resourceId` already used |
| `USER_DOESNT_EXIST` | — | — | a listed member is not a context user |

> Membership tampering / broken chain / unauthorized signer are **not** bridge errors — they are detected
> client-side during verification (§4-B) and surfaced as `statusCode`≠0 on the decrypted group.

---

## 6. Events

Group events are emitted on the **`context`** channel to the group's members (and, on update/delete, to
removed members so their clients drop state).

```jsonc
// groupCreated / groupUpdated  — data is the full GroupInfo (see §2.4)
{ "type": "groupUpdated", "channel": "context", "timestamp": 1719500500000, "data": { /* GroupInfo */ } }

// groupDeleted
{ "type": "groupDeleted", "channel": "context", "timestamp": 1719500900000,
  "data": { "groupId": "group_5f3a", "contextId": "context_ab12" } }
```

> A group membership change does **not** emit events on the *containers'* channels. The endpoint reconciles
> (lazy re-key on next write, §I) — the bridge cannot re-key containers (zero-knowledge).
