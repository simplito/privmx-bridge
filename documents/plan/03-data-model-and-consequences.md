# 03 — Data model & consequences

> Status legend in [README.md](./README.md). Source: [../../src/db/Model.ts](../../src/db/Model.ts),
> [../../src/db/RepositoryFactory.ts](../../src/db/RepositoryFactory.ts).
> This doc lists **every schema change and its consequences** — both intended and the ones easy to miss.

---

## 1. New collection: `group`

`db.group.Group` (collection name `"group"`, id prop `"id"`, registered as `createGroupRepository` in
`RepositoryFactory`). Modeled on `db.thread.Thread`, with the signed-log fields added.

```ts
namespace group {
  interface Group {
    id: types.group.GroupId;
    clientResourceId?: types.core.ClientResourceId;
    contextId: types.context.ContextId;
    type?: types.group.GroupType;
    groupPubKey: types.cloud.GroupPubKey;           // stable identity (public half only)
    createDate; creator; lastModificationDate; lastModifier;
    keyId: types.core.KeyId;                          // current data-key id
    data: types.group.GroupData;                      // opaque encrypted blob
    allTimeUsers; users; managers;                    // UserId[]
    keys: types.cloud.UserKeysEntry[];                // members' data-key blobs (reused mechanism)
    history: GroupHistoryEntry[];                     // signed, chained membership log; version = length
    policy?: types.cloud.ContainerPolicy;
    // 🟡 planned (MLS-lite): keyVersion (epoch int), keyHistory (past pubkeys) — NOT present today
  }

  interface GroupHistoryEntry {
    keyId; data; users; managers; groupPubKey; created; author;   // snapshot fields
    op: "create" | "update" | "modifyMembers";                    // current scope emits only create|update; modifyMembers deferred (doc 08)
    delta?: { usersAdded; usersRemoved; managersAdded; managersRemoved };  // 🟡 deferred — only set by modifyMembers (doc 08)
    authorPubKey: types.cloud.UserPubKey;                         // snapshot of signer's context key
    prevSignature: types.core.EccSignature | null;                // chain link (null = genesis)
    signature: types.core.EccSignature;                           // author's signature over canonical payload
  }
}
```

**Consequences**

- `version` is **derived** (`history.length`) — never stored as its own field, exactly like threads. Any
  code comparing versions must read `history.length`, not a `version` column.
- The `history` array grows **unbounded** (append-only; never rewritten). Each `update` (full replace) adds
  one entry — and since membership changes are full replaces in the current scope, **every** add/remove costs
  one entry plus a full key-set rewrite. For very churny groups this is the main growth vector — see §7
  (retention) and the deferred delta path ([08-future-plans.md](./08-future-plans.md) §1), which would reduce
  the per-add key-set cost.
- `keys` holds **one `UserKeysEntry` per member** for the group's *own* data key. This is the O(members)
  redistribution cost on membership change. The group is **not** itself group-grantable (no `groups`/
  `groupKeys` fields) → access resolution is one level deep, no recursion.
- `groupPubKey` is stored in the **clear** and is **stable**; rotating it (allowed on `groupUpdate`) records
  the new value in a new history entry. Containers that wrapped `CK` to the old `groupPubKey` are now stale
  and must be re-keyed by a client (the bridge can't). Treat pubkey rotation like a removal for re-key
  purposes.
- `authorPubKey` is snapshotted **per entry** so historical entries remain verifiable even after a manager's
  context key rotates. The endpoint's "was an authorized manager at the time" check uses the membership
  state implied by the chain up to that entry, not current membership.

---

## 2. Container documents: two new optional fields

Added to **all five** container docs (`thread.Thread`, `store.Store`, `inbox.Inbox`, `stream.StreamRoom`,
`kvdb.Kvdb`) **and** their `*HistoryEntry`:

```ts
groups?:    types.cloud.GroupGrant[];     // OPTIONAL — [{groupId, role:"user"|"manager"}]
groupKeys?: types.cloud.GroupKeysEntry[]; // OPTIONAL — [{group, keys: KeyEntry[]}]  (history entries carry groups only)
```

(`*HistoryEntry` carries `groups?` but not `groupKeys?` — history records *who was granted*, not the key
blobs.)

**Consequences**

- **Optionality is load-bearing for backward compatibility.** Existing documents written before the feature
  have neither field; reads must treat `undefined` as `[]`. **No migration/backfill is required.** See
  [07-backward-compatibility-and-migration.md](./07-backward-compatibility-and-migration.md).
- A container's *effective audience* = direct `users`/`managers` **∪** members of every group in `groups`.
  The bridge resolves the second part live; it is **not** materialised onto the container. So the container
  doc alone does not tell you who can read it — you must also resolve group membership.
- `groupKeys` (DB `{group, keys}`) and the API `GroupKeyEntrySet {group, keyId, data}` are **different
  shapes**; `CloudKeyService.buildGroupKeys` merges incoming API entries into the stored grouped form.

---

## 3. Indexes (operational requirement)

The "list my containers" path resolves the caller's group ids, then filters each container collection with
`$elemMatch` on the `groups` array. To keep that efficient:

- **Index `groups.groupId`** on each of the 5 container collections (multikey index on the array's
  `groupId`). Without it, scope/pagination queries do collection scans for users who are group members.
- **Index `(contextId, users)` and `(contextId, managers)`** on the `group` collection — backs
  `GroupRepository.getGroupsOfUser(contextId, userId)`, which runs on **every** "list containers" call for a
  user (see §4). This is the hottest new query.
- Existing container indexes (`contextId`, `users`, `managers`) are unchanged and still used for the direct
  branches of the `$or`.

> Action item for the implementer: confirm these indexes exist in the collection setup / migration scripts.
> The functional code is done; the index definitions are the operational tail.

---

## 4. Access-resolution consequences (the subtle, cross-cutting ones)

### 4.1 `getCallerGroupIds` runs on read/list paths
`BaseContainerService.getCallerGroupIds(contextId, userId)` → `GroupRepository.getGroupsOfUser` is invoked to
resolve which groups the caller belongs to, then:
- `withGroupMembership(container, userId, userGroupIds)` splices the caller into the container's `users` (or
  `managers`, if the matching grant's `role === "manager"`) **in memory**, so the existing
  `BasePolicy.getPolicyUser` / `isOnUsersList` / `isOnManagersList` logic grants access unchanged.
- `ContextRepository.getScopeFilter` / `getPaginationFilterForContainer` add
  `{groups: {$elemMatch: {groupId: {$in: userGroupIds}}}}` (role-scoped for MANAGER scope) to the `$or`.

**Consequence:** every container read/list for a user now costs **one extra `group` query** to resolve
memberships. Cache-friendly within a request, but it is a new per-request dependency on the `group`
collection. Plan capacity accordingly (and see the index note above).

### 4.2 Server access ⊇ cryptographic access
The bridge grants **server-side visibility** (list/get) to anyone in a granted group, including clients that
cannot decrypt. Concretely:
- An **old client** that happens to be a member of a group used as a grantee will see those containers in its
  listings but **cannot decrypt** them (it doesn't understand group keys) → it surfaces a decrypt/no-key
  error. This is acceptable per the project assumption ("older versions may receive app exceptions") but is a
  real UX edge — documented in [07](./07-backward-compatibility-and-migration.md) §5.
- A **just-removed** member is server-blocked immediately, but forward secrecy of *new* content depends on
  the lazy re-key (🟡🔵). See [01-architecture-overview.md](./01-architecture-overview.md) §5.

### 4.3 `removeUserFromContext` does NOT touch group membership
`ContextService.removeUserFromContext` removes the context-user row and notifies, but **does not** remove that
user from any group's `users`/`managers`. **Consequence:** a user removed from a context can remain listed as
a group member in the `group` collection. The bridge's live access check still gates them (they're no longer
a context user, so `getUserFromContext` fails), but the *group document* is now stale. A manager/endpoint
should run `groupUpdate` (full replace) to clean them out (and re-key). Document this as an operational follow-up; do
not rely on context removal to prune groups.

---

## 5. `GROUP_IN_USE` referential integrity
`GroupService.deleteGroup` refuses deletion while the group is referenced by any container, checking
`isGroupReferenced(groupId)` on **all five** container repositories
(`q.arrayProp("groups").eq("groupId", groupId)`, limit 1).

**Consequence:** there are no dangling group references — a container's `groups` always points at a live
group. The cost is an O(5) existence probe per delete. Deletion order matters operationally: remove the group
from all containers (via container `*Update`) **before** `groupDelete`, or the delete is rejected.

---

## 6. Role field: `ContainerRole` today, `GroupRole` planned (🟡)
Today `GroupGrant.role: ContainerRole = "user" | "manager"`. The plan is to migrate to
`GroupRole {READ, WRITE, PUSH}` (SIMPLITO spec). Because the grant is already a **role-tagged object**
(`{groupId, role}`), this is a *value-domain* change, not a shape change:

- The DB array shape (`GroupGrant[]`) is unchanged; only the `role` string domain widens.
- `$elemMatch` filters that test `role: "manager"` (MANAGER scope) become `role: {$in: [WRITE, PUSH]}` (or
  whatever the manager-equivalent set is).
- `withGroupMembership`'s `g.role === "manager"` branch becomes a mapping from `GroupRole` → users/managers
  list.
- **Backward-compat for stored grants:** decide whether to (a) migrate existing `"user"`/`"manager"` values
  to the new enum with a one-time data migration, or (b) accept both domains and translate on read. Given the
  feature is new (no production groups yet on a released version), a clean cutover before GA is simplest.

---

## 7. Retention / growth
- `group.history` and each container's `*HistoryEntry` list grow with every update. The signed log **must**
  be append-only for verification, so history cannot be pruned without breaking chain replay.
- **Signed checkpoints (🟡) bound both verification cost and history size.** A manager periodically appends a
  `checkpoint` entry (a new `GroupSignatureOp`, [02-bridge-api-contract.md](./02-bridge-api-contract.md) §7.1)
  that signs *"as of `prevSignature` H_k, authorized members = M, managers = G, groupPubKey = P"*. A client
  that trusts the checkpoint signer can:
  - **replay from the checkpoint instead of genesis** → cold-start verification is O(entries since last
    checkpoint), not O(total) (client-side detail in [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §5.1); and
  - **prune** entries before a checkpoint (the checkpoint becomes the new trusted base case), capping
    `history` length.
  - Trust note: a checkpoint trusts one manager's attestation of the pruned prefix. Harden with
    **threshold / multi-manager co-signed** checkpoints and occasional full audits ("trust but verify") so a
    forged checkpoint is eventually caught. If you prune, keep at least the last checkpoint + its tail.
  - Alternative without trusting a signer: a transparency-log **Merkle** structure (consistency proofs) lets
    clients verify the un-replayed prefix is append-only in O(log n) without re-checking its signatures — at
    the cost of the bridge maintaining a Merkle tree. Heavier; reserve for when checkpoint-signer trust is
    unacceptable.
  - Out of scope for v1; note the growth and design `history` reads so a future checkpoint/prune is additive.
- The O(members) `keys` array on the group is rewritten on every membership change. For large groups this is
  the dominant write cost; it is the accepted trade-off for keeping **group-as-grantee** (one container wrap
  per group regardless of size). See [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §7.
