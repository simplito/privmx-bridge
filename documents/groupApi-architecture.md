# Group API — Architecture & Implementation Reference

> **⚠️ PARTIALLY SUPERSEDED — historical reference.** The live, authoritative specs are in
> [plan/](./plan/) and the phase dirs ([endpoint_phase_one/](./endpoint_phase_one/),
> [bridge_phase_two/](./bridge_phase_two/), [endpoint_phase_two/](./endpoint_phase_two/)). Decisions made
> *after* this doc that override parts of it:
> - **GroupMembershipSignature DROPPED** (plan/10 §3b): the bridge stores group `data` opaquely and **verifies
>   nothing**; the membership proof moved into the endpoint DIO inside `data`, verified client-side. Wherever
>   this doc says the bridge verifies signatures / a `prevSignature` chain / `PMX_GROUP_SIG` / stores
>   `signature` fields → **stale**.
> - **`modifyMembers` (delta) DEFERRED** (plan/08): current membership change = full-replace `groupUpdate`.
> - **Phasing changed.** This doc's old two-phase split labelled **group-as-grantee** "Phase 2", but
>   group-as-grantee **IS implemented** (it's part of the *current* Phase 1). What is genuinely **not yet
>   implemented** is the **epoch / forward-secrecy** set (`keyVersion`/`keyHistory`, `generateNewGroupKey`,
>   CAS + `ROTATED_ALREADY`, key-confirmation tag, rotation rate-limit, lazy re-key on write) — that is the
>   *current* Phase 2, specified in [bridge_phase_two/](./bridge_phase_two/) + [endpoint_phase_two/](./endpoint_phase_two/).

Status: **Phase 1 implemented in privmx-bridge** (`tsc` + lint clean, unit tests green); Phase 2 = planned.
Endpoint (privmx-endpoint / C++): **not yet implemented** — see [endpoint_phase_one/](./endpoint_phase_one/).

Related docs:
- [groupApi.md](./groupApi.md) — the original draft sketches (TS + C++).
- ~~[groupMembershipSignature.md](./groupMembershipSignature.md)~~ — **OBSOLETE** (signed-log dropped; see banner above).

---

## 1. What a Group is

A **Group** is a context-scoped, end-to-end-encrypted, container-like resource that serves two roles:

1. **A managed set of members** — it has `users` (members) and `managers`, a `keyId`-based symmetric data
   key distributed to members (`UserKeysEntry[]`, exactly like a thread), and opaque encrypted `data`.
2. **A grantee identity** — it has a stable public identity `groupPubKey`. A group can be added to any
   container (thread/store/inbox/kvdb/stream) as a single member entity; the container key is encrypted
   once to the `groupPubKey` instead of once per member. Members holding the group's private key derive
   container access.

The bridge is **zero-knowledge**: it stores opaque blobs, verifies key coverage and signatures, enforces
ACL/policy, runs queries, and emits events. All cryptography (group keypair generation, distributing the
group private key to members, encrypting container keys to `groupPubKey`) is the endpoint's job.

### Design decisions

| Decision | Choice |
|---|---|
| API surface | Folded into **`ContextApi`** (`context.group*`), **not** a separate `group.` namespace, backed by a dedicated `GroupService`. |
| Key model | Reuse the existing `keyId`-based container key distribution (`CloudKeyService`) for the group's own data key, **plus** a stable `groupPubKey` identity used when granting the group access to other containers. |
| Membership API | Both a full-replace `groupUpdate` (optimistic `version` + `force`) **and** a delta `groupModifyMembers`. |
| Trust / integrity | Every membership-mutating op is **signed**; the bridge keeps a chained, append-only, signed log that the endpoint verifies client-side. |
| Grantee scope | Group-as-grantee from day one; all five container types accept group members. |

---

## 2. RPC surface (on `ContextApi`)

All methods require a context session (`sessionService.validateContextSessionAndGetCloudUser()`).

| Method | Model → Result | ACL action |
|---|---|---|
| `context.groupCreate` | `GroupCreateModel` → `{groupId}` | `context/groupCreate` |
| `context.groupUpdate` | `GroupUpdateModel` → `OK` (full replace) | `context/groupUpdate` |
| `context.groupModifyMembers` | `GroupModifyMembersModel` → `OK` (delta) | `context/groupUpdate` |
| `context.groupDelete` | `{groupId}` → `OK` | `context/groupDelete` |
| `context.groupGet` | `{groupId, type?}` → `{group: GroupInfo}` | `context/groupGet` |
| `context.groupList` | `GroupListModel` → `{groups: GroupInfo[], count}` | `context/groupList` |

### Request models (key fields)

```ts
GroupCreateModel = {
  contextId; resourceId?; type?;
  groupPubKey;                 // stable group identity (ECC pubkey)
  users[]; managers[];         // UserId[]
  data;                        // opaque
  keyId; keys: KeyEntrySet[];  // group's own data key, distributed to members
  policy?;                     // ContainerPolicy
  signature;                   // ECC signature over the canonical genesis payload
}

GroupUpdateModel = GroupCreateModel-ish + {
  id; version; force;
  prevSignature;               // must equal the current head entry's signature
}                              // (no resourceId mismatch rewrite)

GroupModifyMembersModel = {
  id;
  usersToAddOrUpdate[]; usersToRemove[];
  managersToAddOrUpdate[]; managersToRemove[];
  keyId; keys: KeyEntrySet[];  // typically a rotated key for the new member set
  signature; prevSignature;
}
```

### Read model

```ts
GroupInfo = {
  id; groupPubKey; contextId; resourceId?; type?;
  createDate; creator; lastModificationDate; lastModifier;
  data: GroupDataEntry[];      // {keyId, data} per version, like thread
  users[]; managers[];
  keys: KeyEntry[];            // filtered to the calling user
  version;                     // = history.length
  policy;
  history: GroupSignedEntry[]; // the full signed membership chain (for client verification)
}

GroupSignedEntry = {
  keyId; groupPubKey; users[]; managers[]; created; author;
  authorPubKey;                // signer's context key snapshot
  op: "create"|"update"|"modifyMembers";
  delta?;                      // present for modifyMembers
  prevSignature; signature;
}
```

### Events (cloud channel `context`)

`groupCreated` / `groupUpdated` → `GroupInfo`; `groupDeleted` → `{groupId, contextId}`. Sent to the
group's members (users + managers).

---

## 3. Signed membership log (security-critical)

> **⛔ STALE — this whole section describes the DROPPED `GroupMembershipSignature` design.** The bridge no
> longer verifies signatures, stores no `signature`/`prevSignature` fields, and has no `PMX_GROUP_SIG` format.
> The same security goal (manager-authorized, tamper-evident membership) is now met by committing the proof in
> the endpoint DIO inside `data` and verifying client-side. Current spec: [plan/10 §3b](./plan/10-endpoint-security-model-and-alignment.md),
> [endpoint_phase_one/03-verification.md](./endpoint_phase_one/03-verification.md).

The bridge is untrusted, so membership cannot be taken on its word. Every create/update/modifyMembers is
signed by its author over a **byte-stable canonical serialization**; entries are chained via
`prevSignature` (genesis = null). The bridge:

1. validates the signature shape (`tv.eccSignature`),
2. verifies the signature at write time against the caller's `ContextUser.userPubKey`
   (`ECUtils.verifySignature2`) → `INVALID_SIGNATURE` on failure,
3. enforces `prevSignature === head.signature` → `GROUP_VERSION_MISMATCH` (detects drop/reorder),
4. stores the signed entry append-only,
5. serves the whole chain so the endpoint can replay genesis→head and verify each link, each signer's
   authorization, and that the replayed member set equals the served `users`/`managers`.

The group is anchored by `groupPubKey` + the chain (NOT the server-assigned `groupId`, which doesn't exist
when genesis is signed). **Full format: [groupMembershipSignature.md](./groupMembershipSignature.md)** —
this must match byte-for-byte on the endpoint.

Implementation: [`src/service/cloud/GroupMembershipSignature.ts`](../src/service/cloud/GroupMembershipSignature.ts).

---

## 4. Group-as-grantee  *(labelled "Phase 2" historically — but IMPLEMENTED; it's current Phase 1)*

A container can grant access to whole groups. Container documents gained (all optional, no migration):

```ts
groups?: GroupGrant[];         // [{groupId, role: "user"|"manager"}] — role-tagged for RBAC-readiness
groupKeys?: GroupKeysEntry[];  // container key encrypted to each group's pubkey (keyed by groupId, role-independent)
                               // stored whole; SERVED narrowed to the caller's own groups (see group-api-reference.md)
```

The grant list is **role-tagged** (one entry per group, with its role) rather than two parallel
`groups`/`groupManagers` arrays — this is the RBAC assignment shape, so adding roles later only widens the
`ContainerRole` union (no new field/array). The user axis (`users`/`managers`) is left as-is (shipped);
both converge into a single `grants` list at full-RBAC time.

- **Create/update** (each container service) accept `groups`, `groupManagers`, `groupKeys`; group
  existence is checked and key coverage verified via `CloudKeyService.checkGroupKeysAndGrantees`
  (mirrors the per-user coverage check, keyed by group).
- **Access** — a caller who belongs to a granted group is treated as a member/manager. Implemented
  without touching the policy engine: `BaseContainerService.withGroupMembership(container, userId,
  callerGroupIds)` returns a shallow copy with the caller spliced into `users`/`managers` when they're in
  `container.groups`/`groupManagers`, so the existing `BasePolicy` role checks just work. The caller's
  group ids come from `BaseContainerService.getCallerGroupIds` (→ `GroupRepository.getGroupsOfUser`).
- **"List my containers"** — the shared `ContextRepository.getScopeFilter` / `getPaginationFilterForContainer`
  now `$or`s a `{groups: {$elemMatch: {groupId: {$in: callerGroupIds}}}}` clause (with `role: "manager"` added
  for the MANAGER scope) into USER/MANAGER/MEMBER scopes.
- **Notifications** — each container's notification service expands recipients to include members of any
  granted groups (`GroupRepository.getMembersOfGroups`).
- **Referential integrity** — `GroupService.deleteGroup` refuses with `GROUP_IN_USE` while the group is
  referenced by any thread/store/inbox/kvdb/stream (each repo has `isGroupReferenced`).

### E2E limitation (must be honored by clients)

When a group's membership changes, the **effective audience** of every container the group belongs to
changes — but the bridge **cannot** re-encrypt container keys for new group members (zero-knowledge). The
bridge only guarantees coverage *at write time* and emits the group event; re-distributing container keys
to new group members is the **endpoint's** responsibility.

---

## 5. ACL & policy

- ACL: `context/groupGet`, `context/groupList` (READ), `context/groupCreate`, `context/groupUpdate`,
  `context/groupDelete` (WRITE) — registered in `CloudAclChecker` inside the existing `context/READ|WRITE|ALL`
  groups, and in the `types.cloud.AclFunctions` union.
- Policy: `ContextPolicy.group?: ContainerPolicy`; `GroupPolicy extends BasePolicy` (`extractPolicyFromContext
  → policy.group`); `DefaultContextPolicy.group` (members read/listAll=all, managers create/update/delete).

---

## 6. Error codes (`AppException`)

`GROUP_DOES_NOT_EXIST` (0x6219), `GROUP_IN_USE` (0x621A), `GROUP_VERSION_MISMATCH` (0x621B). Reuses existing
`INVALID_SIGNATURE`, `DUPLICATE_RESOURCE_ID`, `RESOURCE_ID_MISSMATCH`, `ACCESS_DENIED`, `INVALID_PARAMS`,
`INVALID_KEY_ID`, `USER_DOESNT_EXIST`.

---

## 7. File map

**New files**
- `src/types/group.ts` — GroupId/GroupData/GroupVersion/GroupType, GroupSignatureOp, GroupMembersDelta, GroupDeleteStatus.
- `src/service/cloud/GroupMembershipSignature.ts` — canonical serialization + verify.
- `src/service/cloud/GroupRepository.ts` — CRUD + getGroupsOfUser/getMembersOfGroups/checkGroupsExistence.
- `src/service/cloud/GroupService.ts` — CRUD + signed-log enforcement + GroupPolicy.
- `src/service/cloud/GroupNotificationService.ts` — group events.
- `src/api/main/context/GroupConverter.ts` — db.group.Group → GroupInfo.
- Tests: `src/test/service/cloud/GroupMembershipSignature.test.ts`, `GroupService.test.ts`, `src/test/validator/MainContextApiValidator.test.ts`.

**Modified (Phase 1)**
- `src/types/index.ts` (`group` export), `src/types/cloud.ts` (`GroupPubKey`, `GroupKeysEntry`, `GroupKeyEntrySet`, `ContainerGrantees`), `src/types/context.ts` (`group` policy).
- `src/db/Model.ts` (`namespace group`), `src/db/RepositoryFactory.ts` (`createGroupRepository`).
- `src/api/AppException.ts` (error codes), `src/api/TypesValidator.ts` (`groupId`, `groupData`, `groupPubKey`, `cloudGroupKeyEntrySet`).
- `src/api/main/context/ContextApi.ts`, `ContextApiTypes.ts`, `ContextApiValidator.ts`, `ContextApiClient.ts`.
- `src/service/cloud/CloudAclChecker.ts`, `PolicyService.ts`, `ContextService.ts` (delete cascade), `src/service/ioc/IOC.ts`.

**Modified (Phase 2 — grantee, per container thread/store/inbox/kvdb/stream)**
- `src/db/Model.ts` (grantee fields on each container + history).
- `CloudKeyService.ts` (`checkGroupKeysAndGrantees`/`buildGroupKeys`/`verifyThatOnlyGivenGroupsHaveAccess`).
- `BaseContainerService.ts` (`getCallerGroupIds`/`withGroupMembership`), `ContextRepository.ts` (scope filter).
- Each `<Container>Repository.ts` (create/update grantees + `isGroupReferenced`), `<Container>Service.ts` (create/update/access/list), `<Container>NotificationService.ts` (recipient expansion).
- Each `<Container>Api.ts` / `*ApiTypes.ts` / `*ApiValidator.ts` / `*Converter.ts` (grantee fields). (Inbox is model-based: only types/validator/service touched.)

---

## 8. Testing

- **Unit (green):** `GroupMembershipSignature` (9) — real-keypair sign/verify, tamper, chain binding,
  list-order independence, op/field binding. `GroupService` (11) — CRUD, bad signature → INVALID_SIGNATURE,
  unknown user → ACCESS_DENIED, version + prevSignature checks, delta removal, GROUP_IN_USE.
  `MainContextApiValidator` (9) — group request validation. Regression: StoreService (35), CloudAclChecker (37).
- **Build gate:** `./node_modules/.bin/tsc` (whole project) + `eslint` clean.
- **Run a single suite:** `npx q2-test out/test/service/cloud/GroupService.test.js` (after `tsc`).
- **Not yet:** end-to-end CloudTests against a running bridge+mongo (needs an endpoint-style signing client);
  per-container grantee e2e (group member can read/list a thread; loses access after `groupModifyMembers`).

---

## 9. Remaining work

1. **Endpoint (C++)** — implement against [groupApi-endpoint-guide.md](./groupApi-endpoint-guide.md) and the
   signing contract; produce shared test vectors.
2. **End-to-end tests** — group CRUD + grantee access/visibility/notifications with a real signing client.
3. **Indexes** — ensure mongo indexes on container `groups`/`groupManagers` arrays (used by the list filter
   and `isGroupReferenced`) and on group membership.
4. **Nested groups** — explicitly out of scope (a group cannot be a member of another group).
5. **Re-key-on-membership-change** — document/own in the SDK as the endpoint's responsibility (see §4).
