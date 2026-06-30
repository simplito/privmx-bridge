# Group feature — review TODOs (`feat/group-api`)

Action items from the code-quality review of the Group feature (66 files, +2430/−109 vs `dev`).
Verdict: **good — a faithful mirror of the thread stack — but not merge-ready**: 1 HIGH security gap,
2 P0 missing-index problems, plus polish. All fixable in a focused pass; none are deep design flaws.

Detail per dimension:
- [security.md](./security.md) — access control, rotation/CAS, rate-limit.
- [performance.md](./performance.md) — DB indexes, query round-trips, history growth.
- [code-quality.md](./code-quality.md) — readability, simplicity, style, tests.

Status legend: `[ ]` open · `[~]` partial · `[x]` done.

---

## Must-fix before merge
- [x] **SEC-1 (HIGH)** `generateNewGroupKey` skips the manager/policy check — add `policy.makeUpdateContainerCheck`. ✅ **done** — [GroupService.ts:155](../../src/service/cloud/GroupService.ts#L155) + non-manager rejection test. → [security.md](./security.md#sec-1)
- [ ] **PERF-1 (P0)** No `group` collection indexes — add a migration (`{contextId,users}`, `{contextId,managers}`, `contextId`). → [performance.md](./performance.md#perf-1)
- [ ] **PERF-2 (P0)** No `groups.groupId` multikey index on the 5 containers — add to the same migration. → [performance.md](./performance.md#perf-2)

## Should-fix
- [x] **SEC-2 (MED)** Rotation rate-limit is consumed on the race-loss path — consume only on success. ✅ **done** — peek (`check`) / commit (`record`) split; charged only after a committed rotation. → [security.md](./security.md#sec-2)
- [ ] **PERF-3 (MED)** `deleteGroup` runs 5 sequential `isGroupReferenced` queries — parallelize. → [performance.md](./performance.md#perf-3)
- [ ] **PERF-4 (MED)** `checkGroupKeysAndGrantees` does a double `getMulti` over the same groups — fetch once. → [performance.md](./performance.md#perf-4)
- [ ] **CQ-1** Groups accept negative `version`/`expectedKeyVersion` — use `tv.intNonNegative`. → [code-quality.md](./code-quality.md#cq-1)
- [ ] **CQ-2** `GROUP_VERSION_MISMATCH` message still says "or broken signature chain" (false now) — fix wording. → [code-quality.md](./code-quality.md#cq-2)

## Nice-to-have
- [x] **SEC-3 (LOW)** Rate-limit keying — **decided: per-group** (bounds epoch churn per BR-4). ✅ **done** — keyed on `groupId`. → [security.md](./security.md#sec-3)
- [ ] **PERF-5 (WATCH)** Unbounded `history`/`keyHistory` growth + full-doc rewrite — trim/checkpoint. → [performance.md](./performance.md#perf-5)
- [ ] **CQ-3** `confirmationTag` plumbed but never interpreted — confirm need / add comment. → [code-quality.md](./code-quality.md#cq-3)
- [ ] **CQ-4** 5× duplicated group-grantee plumbing in container services — extract a `BaseContainerService` helper. → [code-quality.md](./code-quality.md#cq-4)
- [ ] **CQ-5** `casRotate` hand-rolls the `id`→`_id` mapping + is `public` though only used internally — comment + `private`. → [code-quality.md](./code-quality.md#cq-5)
- [ ] **CQ-6** Test gaps: `casRotate` unit test, negative-version validator test, `DUPLICATE_RESOURCE_ID`/`RESOURCE_ID_MISSMATCH` for groups. → [code-quality.md](./code-quality.md#cq-6)

---

## What's already good (no action)
- CAS (`casRotate`) atomic + in-session (no TOCTOU); `withGroupMembership` can't escalate a `"user"` grant to manager; filters take only server-derived values (no Mongo injection); `buildRotatedAlreadyData` returns only the caller's own key entry; coverage/anti-ghosting + mandatory `groupEpoch` enforced on all write paths.
- Faithful thread-stack mirror (DI, `@ApiMethod`, validator builder, converter key-filtering, IOC, notifications, `AppException`); IPC limiter mirrors `NonceMap`; the `GroupMembershipSignature` drop was clean (no leftover symbols).
- Unit + e2e tests match repo style and cover the right Phase-2 behaviors.
