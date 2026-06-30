# Patches

Working-tree diffs produced for review, not pushed to any remote. Apply with `git apply`, revert by reverse-applying.

> **Current authoritative patch: `drop-group-signing.patch`** (full `git diff` of `src/` vs `HEAD`). It is the
> combined current state of the group code and **includes + supersedes** `defer-modifymembers.patch` (which is
> kept only for history). Apply just `drop-group-signing.patch` onto a clean tree.

---

## `drop-group-signing.patch` (authoritative)

Implements [../10-endpoint-security-model-and-alignment.md](../10-endpoint-security-model-and-alignment.md)
§3b: **drop `GroupMembershipSignature`; the bridge stores group data opaquely and does not sign/verify.**
Signing + verification (member set + chain link) move entirely to the endpoint, committed inside the `data`
DIO and verified client-side.

Bridge changes (15 files, ~+54/−736):
- **Deleted:** `src/service/cloud/GroupMembershipSignature.ts` (+ its unit test).
- **Removed `signature`/`prevSignature`** from `GroupCreate`/`GroupUpdate` models, validators, `ContextApi`,
  `ContextApiClient`.
- **Removed signed-log fields** (`op`/`delta`/`authorPubKey`/`prevSignature`/`signature`) from
  `db.group.GroupHistoryEntry`, `GroupRepository` (+ `GroupEntrySignature`), and `GroupService`
  (`verifyAndBuildSignature`/`checkChainLink` gone; no `INVALID_SIGNATURE` on the group path).
- **Removed types** `GroupSignatureOp`, `GroupMembersDelta` (`src/types/group.ts`); the dormant
  `GroupService.modifyGroupMembers` (it depended on the deleted signing).
- `GroupSignedEntry` → **`GroupHistoryEntryInfo`** (reduced to `{keyId, groupPubKey, users, managers, created,
  author}`).
- Kept: group CRUD, group-as-grantee, ACL, key-coverage, `version` optimistic-concurrency
  (`GROUP_VERSION_MISMATCH`), `GROUP_IN_USE`, append-only `history` (so clients can replay the `data` DIO).

### Verification
- `npm run build` (tsc) → exit 0; `eslint --fix` on all changed files → exit 0.
- Unit suites: `GroupService.test` 8/8, `MainContextApiValidator.test` 6/6 — pass.
- E2E (`MainGroupApiTest`, `ThreadGroupGranteeTest`) compile; the signature/chain tests were replaced with a
  version-CAS test; need a live bridge + MongoDB to run.

### Apply / revert
```sh
git apply documents/plan/patches/drop-group-signing.patch     # onto a clean tree
git apply -R documents/plan/patches/drop-group-signing.patch  # or: git checkout -- src/
```
Nothing was committed or pushed.

---

## `defer-modifymembers.patch`

**Implements the scope decision in [../08-future-plans.md](../08-future-plans.md): defer the delta
`modifyMembers` path; full-replace `groupUpdate` is the only current membership mechanism.**

It **removes the `modifyMembers` API surface** while **keeping the implementation + signing primitives dormant**
for the future:

Removed (active RPC surface):
- `src/api/main/context/ContextApi.ts` — `groupModifyMembers` `@ApiMethod`.
- `src/api/main/context/ContextApiTypes.ts` — `GroupModifyMembersModel` interface + the `IContextApi` member.
- `src/api/main/context/ContextApiClient.ts` — `groupModifyMembers` client method.
- `src/api/main/context/ContextApiValidator.ts` — `groupModifyMembers` validator registration.
- `src/test/validator/MainContextApiValidator.test.ts` — the two `groupModifyMembers` validator tests.

Rewritten:
- `src/test/end2end/CloudTests/ThreadGroupGranteeTest.test.ts` — the "remove Alice from group" step now uses
  full-replace `groupUpdate` (was `groupModifyMembers`).

Kept dormant (not in the active RPC surface, preserved for the future per doc 08 §1):
- `src/service/cloud/GroupService.ts` — `modifyGroupMembers(...)` (still covered by `GroupService.test.ts`).
- `src/service/cloud/GroupMembershipSignature.ts` — the `"modifyMembers"` op + delta canonical fields.
- `src/types/group.ts` — `GroupSignatureOp` (`"modifyMembers"`) and `GroupMembersDelta`.

### Verification
- `npx tsc --noEmit` → exit 0.
- `eslint` on changed files → exit 0.
- Unit suites (build + `q2-test`): `GroupService.test` 11/11, `GroupMembershipSignature.test` 9/9,
  `MainContextApiValidator.test` 7/7 — all pass. The dormant `modifyGroupMembers` is still exercised by
  `GroupService.test` ("Should modify group members (remove a user)").
- E2E suites (`MainGroupApiTest`, `ThreadGroupGranteeTest`) compile but require a live bridge + MongoDB to run;
  not executed in this environment.

### Apply / revert
```sh
# the working tree already contains these changes (uncommitted); to reproduce on a clean tree:
git apply documents/plan/patches/defer-modifymembers.patch
# to revert the working tree:
git apply -R documents/plan/patches/defer-modifymembers.patch     # or: git checkout -- src/
```

Nothing was committed or pushed.
