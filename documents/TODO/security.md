# Group feature — security TODOs

Findings on access control, rotation/CAS, and rate-limiting. Back to [README](./README.md).

---

<a id="sec-1"></a>
## SEC-1 (HIGH) — `generateNewGroupKey` skips the manager/policy check — ✅ FIXED

> **Resolved.** Added `this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, undefined)`
> at [GroupService.ts:155](../../src/service/cloud/GroupService.ts#L155) (rotation changes neither membership
> nor policy, so existing managers + no policy). New test *"Should reject generateNewGroupKey from a
> non-manager (context ACL alone is insufficient)"* asserts a member with `ALLOW ALL` ACL is denied
> `ACCESS_DENIED` and the repo rotation is never called. Build + 17 GroupService tests green.


- **Where:** [GroupService.ts:144-177](../../src/service/cloud/GroupService.ts#L144) (gate at [:152](../../src/service/cloud/GroupService.ts#L152)).
- **Problem:** `generateNewGroupKey` does only
  `cloudAclChecker.verifyAccess(user.acl, "context/groupUpdate", [...])` + `checkRotationRateLimit`.
  Unlike `updateGroup` ([:110-112](../../src/service/cloud/GroupService.ts#L110)), `createGroup`, and
  `deleteGroup`, it **never calls `policy.makeUpdateContainerCheck`**. The group `update` policy defaults to
  `"manager"`, so a context user who holds the `context/groupUpdate` ACL **but is not a manager — or even a
  member — of the group** can force-rotate its key, invalidating every grantee container's epoch (a cheap
  denial/disruption primitive).
- **Why it matters:** ACL grants are often context-wide; the per-group manager gate is what actually scopes
  who may mutate a *specific* group. Rotation is a mutation and must pass the same gate as `updateGroup`.
- **Fix:** before the rate-limit/CAS, add
  `this.policy.makeUpdateContainerCheck(user, context, oldGroup, oldGroup.managers, /*itemPolicy*/ undefined)`
  — mirror the exact call `updateGroup` makes (match its argument shape).
- **Test:** ACL-present-but-not-manager → `ACCESS_DENIED`; manager → success. Add to
  [GroupService.test.ts](../../src/test/service/cloud/GroupService.test.ts).

---

<a id="sec-2"></a>
## SEC-2 (MED) — rotation rate-limit is consumed on the race-loss path — ✅ FIXED

> **Resolved.** Split `GroupRotationRateLimiter` into **peek** (`check`, no quota consumed) and **commit**
> (`record`). `generateNewGroupKey` peeks before the CAS and calls `record` only **after** the rotation
> commits (after the transaction returns), so `ROTATED_ALREADY` / version-mismatch losers don't burn quota.
> Tests: *"check() is a peek and does not consume quota"*, *"charges … only after a successful rotation"*,
> *"does NOT charge … on a lost CAS race"*.


- **Where:** [GroupService.ts:153](../../src/service/cloud/GroupService.ts#L153) (`checkRotationRateLimit`
  runs *before* the `expectedKeyVersion`/CAS check at [:155+](../../src/service/cloud/GroupService.ts#L155)).
- **Problem:** the limiter records a token *before* the version/CAS check. A client that loses a rotation
  race (`ROTATED_ALREADY`) still burns quota, so under contention a legitimate manager can be locked out
  after 10 **failed** attempts — none of which produced a rotation.
- **Fix:** split into peek (does adding one exceed the window?) → perform CAS → commit the token only on a
  successful rotation. Don't charge `ROTATED_ALREADY`/CAS-loss against the budget.
- **Note:** keep the limiter cross-worker (the IPC `GroupRotationRateLimiter`); this is about *when* the
  token is consumed, not where it lives.

---

<a id="sec-3"></a>
## SEC-3 (LOW) — rate-limit keying (per-user vs per-group) — ✅ DECIDED: per-group

> **Resolved (decision: per-group).** BR-4 bounds epoch churn, which is a per-group cost regardless of which
> manager triggers it, so the limiter is now keyed on `groupId` alone via `rotationRateLimitKey(groupId)`
> ([GroupService.ts](../../src/service/cloud/GroupService.ts)). A group is capped at 10 rotations/hr in total.
> Accepted tradeoff: one manager can momentarily exhaust a group's shared budget — acceptable because
> managers are trusted and 10/hr is already generous. Test renamed to *"rate-limits each group independently"*.

---

## Verified clean (no action)
- **CAS atomicity:** `casRotate` uses `replaceOne` filtered on `{_id, keyVersion: expected}` and runs **in
  the same session/transaction** — no TOCTOU between the version read and the swap.
- **No privilege escalation:** `withGroupMembership` / `getCallerGroupIds` resolve a caller's role from group
  membership without ever upgrading a `"user"` grant to manager.
- **No injection:** repository filters (`$elemMatch`, `$or`, `$in`) take only server-derived ids/userids.
- **No key leak:** `buildRotatedAlreadyData` returns only the **caller's own** key entry from the winning
  envelope, not the whole key set.
- **Coverage / anti-ghosting:** `checkGroupKeysAndGrantees` enforces set-equality of grantees and (Option A)
  a **mandatory, exact** `groupEpoch` on every write path — a removed member can't be silently retained.
- **Delete race (`GROUP_IN_USE`)** is inert: even if a container grant dangles momentarily,
  `getCallerGroupIds` only returns live groups, so no access is granted off a deleted group.
