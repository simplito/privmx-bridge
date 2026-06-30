# Group feature — readability / simplicity / style / tests TODOs

Back to [README](./README.md).

---

<a id="cq-1"></a>
## CQ-1 — groups accept negative `version` / `expectedKeyVersion`

- **Where:** [ContextApiValidator.ts:64](../../src/api/main/context/ContextApiValidator.ts#L64)
  (`groupUpdate` → `version: this.builder.int`) and
  [:74](../../src/api/main/context/ContextApiValidator.ts#L74) (`groupGenerateNewKey` →
  `expectedKeyVersion: this.builder.int`).
- **Problem:** every sibling validator uses `tv.intNonNegative` for version-like fields (e.g.
  `ThreadApiValidator`). Groups accept negatives — not exploitable (a negative version just never matches
  `history.length`/`keyVersion`, so it falls through to a mismatch), but it's inconsistent and sloppy.
- **Fix:** use `this.tv.intNonNegative` (or the builder's non-negative int) for both fields.
- **Test:** add a validator test asserting a negative version is rejected (see CQ-6).

---

<a id="cq-2"></a>
## CQ-2 — `GROUP_VERSION_MISMATCH` message references a signature chain that no longer exists

- **Where:** [AppException.ts:133](../../src/api/AppException.ts#L133) — message is
  `"Group version mismatch or broken signature chain"`.
- **Problem:** the bridge verifies **no** signature chain since `GroupMembershipSignature` was dropped
  (bridge is store-only; integrity lives in the endpoint's `DataIntegrityObject`). The "broken signature
  chain" clause is now false and misleading.
- **Fix:** reword to `"Group version mismatch"` (or `"… — reload and retry"`).

---

<a id="cq-3"></a>
## CQ-3 — `confirmationTag` plumbed end-to-end but never interpreted

- **Where:** `GroupHistoryEntry.confirmationTag?` ([Model.ts](../../src/db/Model.ts)) and the model/validator
  plumbing.
- **Problem:** stored and returned opaquely, never read by the bridge. After the signature drop, confirm it's
  still needed (endpoint-side key-confirmation) — if yes, add a one-line comment that it's intentionally
  opaque; if no, remove it to avoid dead surface.

---

<a id="cq-4"></a>
## CQ-4 — 5× duplicated group-grantee plumbing across container services

- **Where:** thread/store/inbox/kvdb/stream services each copy the same `checkGroupKeysAndGrantees` call +
  `{groups, groupKeys}` pass-through.
- **Problem:** defensible (they don't share an update path), but a future grantee-coverage bug must be fixed
  in five places.
- **Fix (optional):** extract a `BaseContainerService` helper (e.g. `verifyContainerGroupGrantees(...)`) the
  five services call. Low urgency; do it when the next grantee change lands.

---

<a id="cq-5"></a>
## CQ-5 — `casRotate` hand-rolls the `id`→`_id` mapping and is `public`

- **Where:** [GroupRepository.ts:209-214](../../src/service/cloud/GroupRepository.ts#L209).
- **Problem:** this is the one spot bypassing `MongoObjectRepository`'s mapping; it's correct but
  un-obvious, and the method is `public` though only used internally by `generateNewGroupKey`.
- **Fix:** add a short comment explaining why `replaceOne` + manual mapping is used (atomic CAS on
  `keyVersion`), and make it `private`.

---

<a id="cq-6"></a>
## CQ-6 — test gaps

Existing unit + e2e suites match repo style and cover the right Phase-2 behaviors; gaps to close:
- [ ] **`casRotate` unit test** — winner swaps (filter matches), loser gets `null` (stale `keyVersion`
  filter), and the v1 `{$or:[{keyVersion:1},{keyVersion:{$exists:false}}]}` branch.
- [ ] **Negative-version validator test** (pairs with CQ-1) — `version`/`expectedKeyVersion` < 0 rejected.
- [ ] **`DUPLICATE_RESOURCE_ID` / `RESOURCE_ID_MISSMATCH`** for groups (parity with the thread suite).
- [ ] **`generateNewGroupKey` access test** (pairs with SEC-1) — non-manager with the ACL is denied.

---

## Verified clean (no action)
- **Readability:** clear naming, methods within repo size norms; inline design comments earn their place.
- **No dead symbols from the signature drop:** no leftover `GroupSignatureOp` / `GroupMembersDelta` /
  `GroupMembershipSignature`.
- **Idiomatic mirror of the thread stack:** DI, `@ApiMethod`, validator builder, repository shape, converter
  key-filtering, IOC wiring, `safe()`/`addJob` notifications, `withTransaction` + post-commit notify,
  `AppException` codes. The IPC `GroupRotationRateLimiter` mirrors `NonceMap` (incl. the `deleteExpired` job).
- **`forwardSecrecy` policy flag** is consistent across types/validator/`PolicyService`.
