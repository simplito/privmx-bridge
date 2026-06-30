# Group feature — performance / DB TODOs

Findings on indexes, query round-trips, and document growth. Back to [README](./README.md).

---

<a id="perf-1"></a>
## PERF-1 (P0) — no indexes on the `group` collection

- **Where:** no migration touches `group` (latest is `Migration070`); `GroupRepository`
  ([GroupRepository.ts](../../src/service/cloud/GroupRepository.ts)) `getGroupsOfUser` queries
  `{$and:[{contextId}, {$or:[{users:userId},{managers:userId}]}]}`.
- **Problem:** this query runs on **every container get/list** (via `getCallerGroupIds` →
  `BaseContainerService.withGroupMembership`) and is a full **COLLSCAN** — it degrades linearly with the
  number of groups in the deployment and sits on the hot read path.
- **Fix:** add a migration creating, on `group`:
  - `{contextId: 1, users: 1}` (multikey) — `getGroupsOfUser` user branch,
  - `{contextId: 1, managers: 1}` (multikey) — manager branch,
  - `{contextId: 1}` — `getGroupsByContext` / context teardown.
  Follow the existing migration style (see `src/db/migration/Migration0XX.ts`); create indexes idempotently.
- **Priority:** launch blocker for performance.

---

<a id="perf-2"></a>
## PERF-2 (P0) — no `groups.groupId` multikey index on the 5 containers

- **Where:** thread/store/inbox/kvdb/stream docs gained `groups: GroupKeysEntry[]`; `isGroupReferenced`
  (delete path) and the group-scoped list `$elemMatch` filter both query `groups.groupId` with no index.
- **Problem:** `deleteGroup`'s referential-integrity check and group-scoped container listing both scan each
  container collection.
- **Fix:** in the same migration, add `{"groups.groupId": 1}` (or `{contextId: 1, "groups.groupId": 1}` to
  match the scope filter) on all five container collections.
- **Priority:** launch blocker for performance.

---

<a id="perf-3"></a>
## PERF-3 (MED) — `deleteGroup` runs 5 sequential reference checks

- **Where:** [GroupService.ts:211-216](../../src/service/cloud/GroupService.ts#L211).
- **Problem:** `isGroupReferenced` is awaited once per container type **sequentially** → 5 serial round-trips
  on the delete path.
- **Fix:** `await Promise.all([...])` over the five checks; short-circuit to `GROUP_IN_USE` if any is true.

---

<a id="perf-4"></a>
## PERF-4 (MED) — double `getMulti` over the same groups in coverage check

- **Where:** `checkGroupKeysAndGrantees` → `checkGroupsExistence` **and** `verifyGroupEpochCoverage`
  ([CloudKeyService.ts](../../src/service/cloud/CloudKeyService.ts)) each fetch the same group set.
- **Problem:** two `getMulti` round-trips for one logical check; also instantiates a fresh group repo.
- **Fix:** fetch the groups once, pass the loaded set to both existence and epoch-coverage verification.

---

<a id="perf-5"></a>
## PERF-5 (WATCH) — unbounded `history` / `keyHistory` growth + full-doc rewrite

- **Where:** `GroupRepository.updateGroup` / `generateNewGroupKey` push to `history` / `keyHistory` and
  persist via `replaceOne` (whole document).
- **Problem:** both arrays grow per write and the entire doc is rewritten each time → linear read/write
  amplification, and a hot/churny group approaches the 16 MB BSON cap over its lifetime. (Containers share
  this `history` pattern, but groups add a second high-churn surface: `keyHistory` per rotation.)
- **Action (follow-up, not a blocker):** decide a retention/checkpoint strategy — cap or compact `history`,
  and keep `keyHistory` to the epochs still referenced by any live grantee. Document the chosen bound.
