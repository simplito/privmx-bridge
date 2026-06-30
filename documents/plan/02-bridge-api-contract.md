# 02 — Bridge API contract

> Status legend in [README.md](./README.md). Everything in this doc is ✅ **implemented** unless tagged 🟡.
> Source of truth: [../../src/api/main/context/ContextApiTypes.ts](../../src/api/main/context/ContextApiTypes.ts),
> [ContextApiValidator.ts](../../src/api/main/context/ContextApiValidator.ts),
> [ContextApiClient.ts](../../src/api/main/context/ContextApiClient.ts).
>
> **⚠️ DESIGN UPDATE (applied in code):** `GroupMembershipSignature` was **dropped**. The bridge **no longer
> signs or verifies** group data and has **no `signature`/`prevSignature` fields**. Membership integrity (the
> signature + chain link committed over the member set) lives **inside the opaque `data` blob** as the
> endpoint's `DataIntegrityObject` (DIO) and is **verified client-side**. The bridge only stores group state +
> the append-only version `history`, and enforces ACL, key-coverage, the `version` optimistic-concurrency
> check, and `GROUP_IN_USE`. See [10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md).
> Sections below have been updated; any lingering "signed"/"signature" wording refers to the endpoint-side DIO,
> not a bridge field.

All group methods are folded into the **existing `ContextApi`** — there is **no `group.` namespace**. They
are auto-discovered `@ApiMethod`s on a class registered with the `context.` prefix, so they surface as
`context.groupCreate`, `context.groupGet`, etc. Every method first calls
`sessionService.validateContextSessionAndGetCloudUser()` and sets `requestLogger.setContextId(...)`.

---

## 1. Shared types

From [../../src/types/group.ts](../../src/types/group.ts):

```ts
export type GroupId = string & {__groupId: never};
export type GroupData = unknown;                                  // opaque, like ThreadData
export type GroupVersion = number & {__groupVersion: never};      // = history.length
export type GroupType = string & {__groupType: never};            // optional, parity with ThreadType

// NOTE: GroupSignatureOp / GroupMembersDelta were REMOVED with GroupMembershipSignature. The membership op +
// delta now live inside the endpoint's DIO (in `data`), not in any bridge type.

export interface GroupDeleteStatus {
    id: GroupId;
    status: "OK" | "GROUP_DOES_NOT_EXIST" | "ACCESS_DENIED" | "GROUP_IN_USE";
}
```

From [../../src/types/cloud.ts](../../src/types/cloud.ts) (group-related additions):

```ts
export type GroupPubKey = types.core.EccPubKey;                   // validated by tv.groupPubKey (alias of eccPub)

export interface GroupKeysEntry  { group: types.group.GroupId; keys: types.core.KeyEntry[]; }      // DB shape
export interface GroupKeyEntrySet { group: types.group.GroupId; keyId: types.core.KeyId; data: types.core.UserKeyData; } // API shape

export type ContainerRole = "user" | "manager";                  // 🟡 → GroupRole {READ,WRITE,PUSH}
export interface GroupGrant { groupId: types.group.GroupId; role: ContainerRole; }

export interface ContainerGrantees { groups?: GroupGrant[]; groupKeys?: GroupKeysEntry[]; }
```

`KeyEntrySet` is the existing `{user, keyId, data}` shape reused for the group's own data key (members'
copies). It is **not** new.

---

## 2. `context.groupCreate`

Creates a group with its genesis version entry. (The membership integrity proof is the endpoint's DIO inside
`data`; the bridge does not see or check it.)

**Request** `GroupCreateModel`:

| Field | Type | Req? | Validator | Notes |
|-------|------|------|-----------|-------|
| `contextId` | `ContextId` | ✔ | `cloudContextId` | |
| `resourceId` | `ClientResourceId` | ✖ | `uuidv4` | idempotency / client id |
| `type` | `GroupType` | ✖ | `optResourceType` | parity with thread type |
| `groupPubKey` | `GroupPubKey` | ✔ | `groupPubKey` (eccPub) | stable group identity public key |
| `users` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | members |
| `managers` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | group admins |
| `data` | `GroupData` | ✔ | `groupData` (unknown ≤16KB) | opaque; carries the endpoint DIO (members + chain-link) |
| `keyId` | `KeyId` | ✔ | `keyId` | the group's data-key id |
| `keys` | `KeyEntrySet[]` | ✔ | list of `cloudKeyEntrySet`, ≤16384 | data key wrapped per member |
| `policy` | `ContainerPolicy` | ✖ | `containerPolicy` | |

(No `signature` field — removed.) **Response** `GroupCreateResult`: `{ groupId: GroupId }`.

**Errors:** `ACCESS_DENIED` (no `context/groupCreate`), `DUPLICATE_RESOURCE_ID`, `INVALID_PARAMS`,
`INVALID_KEY_ID`, `USER_DOESNT_EXIST`.

---

## 3. `context.groupUpdate` (full replace)

Optimistic full replacement of members/keys/data/policy/pubkey.

**Request** `GroupUpdateModel`:

| Field | Type | Req? | Validator | Notes |
|-------|------|------|-----------|-------|
| `id` | `GroupId` | ✔ | `groupId` | |
| `groupPubKey` | `GroupPubKey` | ✔ | `groupPubKey` | may rotate the identity key (recorded in the new entry) |
| `resourceId` | `ClientResourceId` | ✖ | `uuidv4` | guarded against mismatch |
| `users` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | full new member set |
| `managers` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | full new manager set |
| `data` | `GroupData` | ✔ | `groupData` | opaque; carries the endpoint DIO (members + chain-link) |
| `keyId` | `KeyId` | ✔ | `keyId` | new (or same) data-key id |
| `keys` | `KeyEntrySet[]` | ✔ | list of `cloudKeyEntrySet`, ≤16384 | |
| `version` | `GroupVersion` | ✔ | `int` | expected current version (= `history.length`) |
| `force` | `boolean` | ✔ | `bool` | bypass the version check |
| `policy` | `ContainerPolicy` | ✖ | `containerPolicy` | |

(No `signature`/`prevSignature` fields — removed.) **Response:** `types.core.OK` (`"OK"`).

**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED` (no `context/groupUpdate`), `GROUP_VERSION_MISMATCH`
(stale `version` without `force`), `INVALID_PARAMS`, `INVALID_KEY_ID`, `USER_DOESNT_EXIST`.

> The chain link (`prevSignature`) is no longer a bridge field — it is committed inside the endpoint's DIO in
> `data` and verified client-side. The bridge's only ordering control on this path is the `version`
> optimistic-concurrency check.

---

## 4. `context.groupModifyMembers` (delta) — 🟡 DEFERRED

**Not in current scope.** Membership changes (add/remove users/managers) are done via full replace
(`groupUpdate`, §3): swap the whole `users`/`managers` set and re-send the whole key set. The delta path —
which would add/remove without re-sending the full sets and bind an explicit signed `delta` — is **deferred**.
Its full request contract, signed-log additions, and bridge order-of-operations are described in
[08-future-plans.md](./08-future-plans.md) §1.

(A working prototype exists on the `feat/group-api` branch but is not the supported path — see
[08-future-plans.md](./08-future-plans.md) §1.6.)

---

## 5. `context.groupDelete`

**Request** `GroupDeleteModel`: `{ groupId: GroupId }`. **Response:** `types.core.OK`.

**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED` (no `context/groupDelete`),
**`GROUP_IN_USE`** — refused while the group is still a grantee of *any* thread/store/inbox/kvdb/stream
(checked via each repo's `isGroupReferenced`).

---

## 6. `context.groupGet` & `context.groupList`

**`groupGet`** — Request `GroupGetModel` `{ groupId, type? }`; Response `GroupGetResult { group: GroupInfo }`.
**Errors:** `GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED` (no `context/groupGet`).

**`groupList`** — Request `GroupListModel extends ListModel { contextId, sortBy?: "createDate" |
"lastModificationDate" }`; Response `GroupListResult { groups: GroupInfo[], count: number }`.
**Errors:** `ACCESS_DENIED` (no `context/groupList`).

**`GroupInfo` (read shape):**

```ts
export interface GroupInfo {
    id: types.group.GroupId;
    groupPubKey: types.cloud.GroupPubKey;
    contextId: types.context.ContextId;
    resourceId?: types.core.ClientResourceId;
    type?: types.group.GroupType;
    createDate: types.core.Timestamp;
    creator: types.cloud.UserId;
    lastModificationDate: types.core.Timestamp;
    lastModifier: types.cloud.UserId;
    data: GroupDataEntry[];                 // {keyId, data} per history entry (so each entry is decryptable)
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    keys: types.core.KeyEntry[];            // filtered to the requesting user (GroupConverter)
    version: types.group.GroupVersion;      // = history.length
    policy: types.cloud.ContainerPolicy;
    history: GroupHistoryEntryInfo[];       // full version history (genesis → head) so the client can replay the DIO chain in `data`
}

export interface GroupDataEntry { keyId: types.core.KeyId; data: types.group.GroupData; }

// Per-version record. The membership signature + chain link is committed inside the opaque `data` (endpoint
// DIO) and verified client-side; the bridge stores it but does not interpret it.
export interface GroupHistoryEntryInfo {
    keyId: types.core.KeyId;
    groupPubKey: types.cloud.GroupPubKey;
    users: types.cloud.UserId[];
    managers: types.cloud.UserId[];
    created: types.core.Timestamp;
    author: types.cloud.UserId;
}
```

`GroupConverter` filters `keys` to the requesting user (`group.keys.find(x => x.user === user)?.keys || []`),
maps `data` from history entries (so each version's DIO is available to the client), derives
`version = history.length`, and returns the full `history` 1:1.

---

## 7. Membership integrity — committed in `data` (endpoint DIO), verified client-side

`GroupMembershipSignature` and the bridge's canonical `PMX_GROUP_SIG` format were **removed**. The bridge has
**no signing/verification responsibility** for groups. Instead:

- The endpoint commits the membership proof **inside the opaque `data` blob** of each version, using the same
  `DataIntegrityObject` (DIO) it already uses for every module (thread/store/…). The DIO binds the author
  (`creatorUserId`/`creatorPubKey`), context/resource, timestamp, per-field checksums, and — for groups — the
  **member set + a chain link to the prior version**, all signed with the author's key (secp256k1 / SHA-256 /
  65-byte compact ECDSA — the endpoint's existing primitive).
- The **bridge stores** `data` per version (in `history`) and serves the whole history back. It does **not**
  parse or verify the DIO.
- The **client verifies** on read: replay `history` genesis→head, verify each version's DIO signature, the
  chain link, that each signer was an authorized manager in the prior verified state, and that the
  bridge-served `users`/`managers` match the DIO-committed set — then route author identity through the
  endpoint's `UserVerifier`.

Full rationale, the gap analysis (chaining + manager-authorization are the two things plain DIO does not
provide), and the endpoint verification algorithm are in
[10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md) and
[06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §4–§5.

> 🟡 The `checkpoint`-op and Merkle-consistency optimizations (to bound re-verification cost) still apply —
> they now live **inside the DIO/`data` scheme** (a checkpoint is a DIO-committed version attesting the prior
> state) rather than in a bridge signature format. See
> [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §5.1.

---

## 8. Container grantee additions (thread/store/inbox/kvdb/stream)

Each container's `*Create` / `*Update` model gains two **optional** fields (shown for thread; identical for
the other four). Optionality is the backward-compatibility lever — see
[07-backward-compatibility-and-migration.md](./07-backward-compatibility-and-migration.md).

```ts
// *CreateModel / *UpdateModel (e.g. ThreadCreateModel)
groups?:    types.cloud.GroupGrant[];        // OPTIONAL — validator: optional(list(groupGrant, 16384))
groupKeys?: types.cloud.GroupKeyEntrySet[];  // OPTIONAL — validator: optional(list(cloudGroupKeyEntrySet, 16384))
```

**Read shape** (`ThreadInfo`, etc.) — these are **required (always present, possibly empty)**:

```ts
groups:    types.cloud.GroupGrant[];     // never undefined in responses
groupKeys: types.cloud.GroupKeysEntry[]; // DB shape, grouped by group
```

**New validators** (in `TypesValidator` / per-container validators): `tv.groupGrant`
(`{groupId, role:"user"|"manager"}`), `tv.cloudGroupKeyEntrySet` (`{group, keyId, data}`), `tv.groupPubKey`
(alias of `eccPub`), `tv.groupId`, `tv.groupData`.

**Coverage rule (server-enforced):** on create/update, the bridge verifies via
`CloudKeyService.checkGroupKeysAndGrantees` that *exactly* the listed group grantees are covered for the
container's `keyId` — no group missing (anti-ghosting), none extra. See
[04-bridge-implementation.md](./04-bridge-implementation.md) §3.

---

## 9. Error codes

Source: [../../src/api/AppException.ts](../../src/api/AppException.ts).

| Code | Hex | When |
|------|-----|------|
| `GROUP_DOES_NOT_EXIST` | `0x6219` | group id not found in context |
| `GROUP_IN_USE` | `0x621A` | delete blocked: group still a container grantee |
| `GROUP_VERSION_MISMATCH` | `0x621B` | stale `version` w/o `force` (optimistic-concurrency only — no longer a chain check) |
| `DUPLICATE_RESOURCE_ID` | `0x6138` | `resourceId` already used |
| `INVALID_PARAMS` | — | malformed input / coverage mismatch / duplicate ids |
| `ACCESS_DENIED` | — | ACL/policy refusal (`context/group*`) |
| `INVALID_KEY_ID` | — | key entry references an unavailable `keyId` |
| `USER_DOESNT_EXIST` | — | a listed member is not a context user |

🟡 Planned additional code: `ROTATED_ALREADY` (carries the winner's epoch envelope on a lost CAS race) — see
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §4.

---

## 10. Events (cloud + management channels)

Emitted by `GroupNotificationService` to the group's `users` + `managers`, on the **`context`** channel:

```ts
type GroupCreatedEvent = types.cloud.Event<"groupCreated", "context", GroupInfo>;
type GroupUpdatedEvent = types.cloud.Event<"groupUpdated", "context", GroupInfo>;
type GroupDeletedEvent = types.cloud.Event<"groupDeleted", "context", GroupDeletedEventData>;
interface GroupDeletedEventData { groupId: types.group.GroupId; contextId: types.context.ContextId; }
```

On `groupUpdate` (and the deferred `groupModifyMembers`), recipients include **removed** members too (so
their clients can react / drop state) — the service tracks `additionalUsersToNotify`.

> Important consequence: a group membership change does **not** emit events on the channels of containers the
> group is a grantee of. The bridge cannot re-key those containers; the endpoint must reconcile. See
> [05-flows.md](./05-flows.md) §6 and [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §6.
