# 04 — Bridge implementation guide

> Status legend in [README.md](./README.md). This maps the contract (doc 02) and model (doc 03) onto the
> actual server files and the order of operations in each method. ✅ unless tagged 🟡.

---

## 1. File map

| Concern | File | Status |
|---------|------|--------|
| RPC methods on ContextApi | [../../src/api/main/context/ContextApi.ts](../../src/api/main/context/ContextApi.ts) | ✅ |
| RPC types | [../../src/api/main/context/ContextApiTypes.ts](../../src/api/main/context/ContextApiTypes.ts) | ✅ |
| RPC validators | [../../src/api/main/context/ContextApiValidator.ts](../../src/api/main/context/ContextApiValidator.ts) | ✅ |
| RPC client | [../../src/api/main/context/ContextApiClient.ts](../../src/api/main/context/ContextApiClient.ts) | ✅ |
| DB→API conversion | [../../src/api/main/context/GroupConverter.ts](../../src/api/main/context/GroupConverter.ts) | ✅ |
| Branded validators | [../../src/api/TypesValidator.ts](../../src/api/TypesValidator.ts) | ✅ |
| Service | [../../src/service/cloud/GroupService.ts](../../src/service/cloud/GroupService.ts) | ✅ |
| Repository | [../../src/service/cloud/GroupRepository.ts](../../src/service/cloud/GroupRepository.ts) | ✅ |
| Policy | [../../src/service/cloud/GroupPolicy.ts](../../src/service/cloud/GroupPolicy.ts) | ✅ |
| Key coverage | [../../src/service/cloud/CloudKeyService.ts](../../src/service/cloud/CloudKeyService.ts) | ✅ |
| ~~Signed log~~ `GroupMembershipSignature.ts` | **DELETED** | ❌ removed (doc 10 §3b) — bridge verifies nothing; integrity moved to the endpoint DIO in `data` |
| ACL | [../../src/service/cloud/CloudAclChecker.ts](../../src/service/cloud/CloudAclChecker.ts) | ✅ |
| Grantee access splicing | [../../src/service/cloud/BaseContainerService.ts](../../src/service/cloud/BaseContainerService.ts) | ✅ |
| Scope/pagination filter | [../../src/service/cloud/ContextRepository.ts](../../src/service/cloud/ContextRepository.ts) | ✅ |
| Notifications | [../../src/service/cloud/GroupNotificationService.ts](../../src/service/cloud/GroupNotificationService.ts) | ✅ |
| DB model | [../../src/db/Model.ts](../../src/db/Model.ts), [RepositoryFactory.ts](../../src/db/RepositoryFactory.ts) | ✅ |
| IOC wiring | [../../src/service/ioc/IOC.ts](../../src/service/ioc/IOC.ts) | ✅ |
| Context cascade | [../../src/service/cloud/ContextService.ts](../../src/service/cloud/ContextService.ts) | ✅ |

---

## 2. `GroupService` — order of operations

All methods take a `CloudUser`/`Executor` from `sessionService.validateContextSessionAndGetCloudUser()`.

> **No signature verification on the bridge.** `GroupMembershipSignature`, `verifyAndBuildSignature`, and
> `checkChainLink` were removed (doc [10](./10-endpoint-security-model-and-alignment.md) §3b). The membership
> proof + chain link is committed inside the opaque `data` (endpoint DIO) and verified client-side. The bridge
> only stores `data` per version.

### createGroup
1. `policyService.validateContainerPolicyForContainer("policy", policy)`.
2. ACL: `cloudAclChecker.verifyAccess(user.acl, "context/groupCreate", [])`.
3. Policy: `groupPolicy.makeCreateContainerCheck(user, context, managers, policy)`.
4. Coverage: `cloudKeyService.checkKeysAndUsersDuringCreation(contextId, keys, keyId, users, managers)`.
5. `groupRepository.createGroup(...)` (genesis history entry, stores opaque `data`). `DbDuplicateError →
   DUPLICATE_RESOURCE_ID`.
6. `groupNotificationService.sendCreatedGroup(group, context.solution)`.

### updateGroup (full replace) — in a transaction
1. Validate policy (if provided).
2. Load `oldGroup = groupRepository.get(id)` → `GROUP_DOES_NOT_EXIST`.
3. ACL `context/groupUpdate` (param `groupId=id`).
4. Policy `makeUpdateContainerCheck`.
5. **Version check (optimistic concurrency):** `if (oldGroup.history.length !== version && !force) →
   GROUP_VERSION_MISMATCH`.
6. Coverage: `cloudKeyService.checkKeysAndClients(availableKeyIds, keyId, oldGroup.keys, keys, keyId, users,
   managers)`; resourceId-mismatch guard.
7. `groupRepository.updateGroup(...)` (appends a version entry storing opaque `data`; may rotate `groupPubKey`).
8. Notify, **including removed members** (`additionalUsersToNotify`).

### modifyGroupMembers (delta) — 🟡 DEFERRED
Not part of the current scope; full replace (`updateGroup`) handles all membership changes. The deferred
delta method's order-of-operations is documented in [08-future-plans.md](./08-future-plans.md) §1.4. A working
prototype exists on the branch (doc 08 §1.6) but is not wired into the supported flow.

### deleteGroup
1. Load `oldGroup` → `GROUP_DOES_NOT_EXIST`.
2. ACL `context/groupDelete`; policy `canDeleteContainer`.
3. **`GROUP_IN_USE` guard** (in transaction): `isGroupReferenced` on thread, store, inbox, kvdb, stream;
   any `true` → `GROUP_IN_USE`.
4. `groupRepository.deleteGroup(id)`; notify (`sendDeletedGroup`).

### getGroup / getGroupsByContext
- `getGroup`: load → ACL `context/groupGet` → `groupPolicy.canReadContainer`.
- `getGroupsByContext`: ACL `context/groupList` → `canListAllContainers` → `groupRepository.getPage`.

### deleteGroupsByContext
- Batch loop (100 at a time) deleting each group + notifying; called from `ContextService.deleteContext`.

### Private helpers
None related to signing — `checkChainLink` / `verifyAndBuildSignature` were removed with
`GroupMembershipSignature`. The bridge keeps only the version-CAS check inline in `updateGroup`.

---

## 3. `CloudKeyService` — group key coverage

```
checkGroupKeysAndGrantees(contextId, availableKeyIds, oldGroupKeys, inserts, keyId, groupIds):
  1. Utils.isUnique(groupIds)                     else INVALID_PARAMS
  2. groupRepository.checkGroupsExistence(contextId, groupIds)   else GROUP_DOES_NOT_EXIST
  3. newGroupKeys = buildGroupKeys(availableKeyIds, oldGroupKeys, inserts)
  4. verifyThatOnlyGivenGroupsHaveAccess(newGroupKeys, keyId, groupIds)   // SET-EQUALITY
  5. return newGroupKeys
```

- `buildGroupKeys` dedups inserts by `(group,keyId)`, validates each `keyId ∈ availableKeyIds` (else
  `INVALID_KEY_ID`), merges over `oldGroupKeys`, returns the sorted DB-shape `GroupKeysEntry[]`.
- `verifyThatOnlyGivenGroupsHaveAccess` enforces **set-equality** (not a count): every listed group has a
  key for `keyId`, and no unlisted group does → **anti-ghosting**. Mismatch → `INVALID_PARAMS`.

This runs in each container's `*Create`/`*Update` when `groups`/`groupKeys` are present. The user-key
coverage (`checkKeysAndClients` / `checkKeysAndUsersDuringCreation`) is the existing per-user equivalent and
runs alongside it.

---

## 4. Access splicing — `BaseContainerService`

```
getCallerGroupIds(contextId, userId): GroupId[]
  -> groupRepository.getGroupsOfUser(contextId, userId)   // groups where user ∈ users ∪ managers

withGroupMembership(container, userId, userGroupIds): container'   // shallow copy
  for each grant g in container.groups where g.groupId ∈ userGroupIds:
     add userId to container'.users
     if g.role === "manager": add userId to container'.managers   // 🟡 becomes GroupRole mapping
  (unique-merged; returns original if no match)
```

Call sites: each container service's read/get/list resolves `userGroupIds` once and passes the spliced
container into `BasePolicy.getPolicyUser`. The pagination query side is handled in `ContextRepository`
(`$elemMatch` on `groups`, role-scoped for MANAGER). Net effect: a group member is treated by **all**
existing user/manager policy and query logic as if directly listed — no change to `BasePolicy` internals.

---

## 5. ACL

`CloudAclChecker` registers, under the existing context ACL groups:
- `context/READ`: `context/groupGet` (param `groupId`), `context/groupList` (no params).
- `context/WRITE`: `context/groupCreate` (no params), `context/groupUpdate` (param `groupId`),
  `context/groupDelete` (param `groupId`).
- `context/ALL` = READ ∪ WRITE.

So a token with `context/READ` can read groups; `context/WRITE` can mutate them. No new top-level ACL group —
consistent with "part of contextApi".

---

## 6. Policy

`GroupPolicy extends BasePolicy`: `extractPolicyFromContext(p) => p.group ?? {}`, `isItemCreator → false`
(groups have no items). `ContextPolicy` gains `group?: ContainerPolicy`; `PolicyService`'s
`DefaultContextPolicy.group` supplies sane defaults (managers create/manage, members read) so pre-existing
contexts behave without migration.

---

## 7. IOC wiring & cascade

- `IOC.getGroupService()` constructs `GroupService(repositoryFactory, activeUsersMap, host, cloudKeyService,
  groupNotificationService, cloudAclChecker, policyService, cloudAccessValidator)`.
- `IOC.getGroupNotificationService()` → `GroupNotificationService(jobService, webSocketSender,
  groupConverter, repositoryFactory)`; `IOC.getGroupConverter()` → `new GroupConverter()`.
- `ContextApi` is constructed with the extra deps: `new ContextApi(contextApiValidator, contextService,
  sessionService, groupService, groupConverter, requestLogger)` at the `context.` registration.
- `ContextService.deleteContext` calls `groupService.deleteGroupsByContext(contextId, context.solution)`
  alongside thread/store/inbox/stream teardown.

---

## 8. 🟡 Planned bridge work (Phase 2) — implementation notes

Not yet coded. **Now fully specified in [../bridge_phase_two/](../bridge_phase_two/)** (this section is a
summary; that directory is authoritative). Note: since `GroupMembershipSignature` was dropped (doc 10 §3b),
the epoch is committed in the endpoint DIO inside `data` (no `GroupSignatureOp`/`op:"rekey"` bridge field).

1. **Epochs:** add `keyVersion: number` + `keyHistory[]` to `db.group.Group`; tag each container `groupKeys`
   entry with the `groupEpoch` it was wrapped under. Bump `keyVersion` on removal-bearing `groupUpdate` (and,
   when the deferred delta path lands, `groupModifyMembers`) and on `generateNewGroupKey`.
   ([../bridge_phase_two/01-data-model.md](../bridge_phase_two/01-data-model.md))
2. **`context.generateNewGroupKey`:** a new `@ApiMethod` + `GroupService.generateNewGroupKey` that mints an
   epoch without a membership delta (compromise recovery). The new epoch/pubkey is committed in the endpoint
   DIO in `data` (no bridge-side `op:"rekey"` signature — that construct was removed with
   `GroupSignatureOp`). ([../bridge_phase_two/02-services-and-rpc.md](../bridge_phase_two/02-services-and-rpc.md))
3. **Optimistic CAS:** make the epoch the concurrency token; `groupRepository.updateGroup` becomes a
   conditional update `where keyVersion = expected`; on miss return `ROTATED_ALREADY` carrying the winner's
   key entry addressed to the caller (replaces the bare `GROUP_VERSION_MISMATCH` on the rotation path).
4. **Rate-limit + manager-only rotation:** enforce in `GroupService` (per `(group, actor)`); auto-rotation
   only on hard roster changes.
5. **Coverage for epochs:** extend `verifyThatOnlyGivenGroupsHaveAccess` to also assert per-epoch coverage on
   re-key writes (it already does set-equality for the current key).
6. **Role migration:** `ContainerRole → GroupRole` (doc 03 §6) touches `withGroupMembership`, the MANAGER
   `$elemMatch`, and validators.
