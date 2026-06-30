# 08 — Future plans (deferred scope)

> Status legend in [README.md](./README.md). Everything here is 🟡 **planned / deferred** — described in
> detail but **not part of the current supported scope**. The current scope changes group membership by
> **full replace** only (`context.groupUpdate` — swap the whole `users`/`managers` set and re-send the whole
> key set). See [05-flows.md](./05-flows.md) §3/§4 for the current add/remove flows.

---

## 1. Delta membership modification — `context.groupModifyMembers`

The headline deferred feature. We fully designed (and prototyped on the `feat/group-api` branch — see the
status note at the end) a **signed delta** path that adds/removes members without re-sending the entire
member set or the entire key set. It is deferred to keep v1 small; full replace covers every membership change
correctly, just less efficiently.

### 1.1 Why a delta path exists (advantages over full replace)

Full replace (`groupUpdate`) is correct but has costs that grow with group size:
- **Add member:** full replace re-sends the **entire** `users`/`managers` set and the **entire** key set
  (every member's key entry), because the bridge's set-equality coverage check requires complete coverage for
  the `keyId`. Adding 1 member to a 5 000-member group re-transmits 5 000 key entries.
- **Auditability:** with full replace, the endpoint must **diff** the previous and new member sets to learn
  *who* changed. The signed payload binds only the resulting sets, not the intent.

The delta path fixes both:
- **Add member:** send only the **new** members' key entries (the unchanged members keep their existing
  entries). O(added) instead of O(all members) for additions.
- **Explicit, signed intent:** the signature binds an explicit `GroupMembersDelta`
  (`usersAdded/usersRemoved/managersAdded/managersRemoved`), so the endpoint verifies *exactly* who was
  added/removed without diffing — a cleaner, tamper-evident audit trail in the membership log.

> Note: **removal** still rotates the data key and re-distributes to the *remaining* members (O(remaining)),
> in both full-replace and delta paths — you cannot avoid re-keying on removal. The delta win is concentrated
> on **additions** and on **explicit auditable intent**.

### 1.2 Request contract (when reintroduced)

`context.groupModifyMembers` — Request `GroupModifyMembersModel`:

| Field | Type | Req? | Validator | Notes |
|-------|------|------|-----------|-------|
| `id` | `GroupId` | ✔ | `groupId` | |
| `usersToAddOrUpdate` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | |
| `usersToRemove` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | |
| `managersToAddOrUpdate` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | |
| `managersToRemove` | `UserId[]` | ✔ | list of `cloudUserId`, ≤16384 | |
| `keyId` | `KeyId` | ✔ | `keyId` | |
| `keys` | `KeyEntrySet[]` | ✔ | list of `cloudKeyEntrySet`, ≤16384 | only the affected members' entries |
| `signature` | `EccSignature` | ✔ | `eccSignature` | log signature, `op:"modifyMembers"`, includes `delta` |
| `prevSignature` | `EccSignature` | ✔ | `eccSignature` | must equal current head's `signature` |

Response: `types.core.OK`. Errors: as for `groupUpdate` (`GROUP_DOES_NOT_EXIST`, `ACCESS_DENIED`,
`GROUP_VERSION_MISMATCH`, `INVALID_SIGNATURE`, `INVALID_PARAMS`, `INVALID_KEY_ID`, `USER_DOESNT_EXIST`).

### 1.3 Membership-proof additions (when reintroduced)

> **Note (post-GroupMembershipSignature-drop, doc 10 §3b):** the bridge no longer signs/verifies, and
> `GroupSignatureOp` / `GroupMembersDelta` were **removed** from the code. When the delta path is
> reintroduced, the `op` + delta are committed **inside the endpoint DIO in `data`** (not as bridge fields /
> the old `PMX_GROUP_SIG` payload). The description below is the *original* design and is kept for the intent;
> map "canonical signing payload" → "DIO `membership` block with an added `delta`".

- The DIO `membership` block gains an `op` discriminator that can be `"modifyMembers"` and an optional
  `delta` (`{usersAdded, usersRemoved, managersAdded, managersRemoved}`), present iff `op === "modifyMembers"`.
- (Original design) the canonical signing payload appended the four **delta** fields only for `modifyMembers`:

  ```
  Field 11: usersAdded      (list, sorted)
  Field 12: usersRemoved    (list, sorted)
  Field 13: managersAdded   (list, sorted)
  Field 14: managersRemoved (list, sorted)
  ```

  These four fields are otherwise absent. The chain link (`prevSignature`) and anchoring on `groupPubKey` are
  identical to the current ops.

### 1.4 Bridge order of operations (when reintroduced)

In a transaction: load `oldGroup` → ACL `context/groupUpdate` → **chain-link check** (`prevSignature` ==
head) → normalise deltas (`Utils.unique`) → compute resulting `users`/`managers` from the deltas → policy
`makeUpdateContainerCheck` → coverage `checkKeysAndClients` against the **resulting** member set → **verify
signature** (`op:"modifyMembers"`, includes `delta`) → append a `modifyMembers` history entry (keeps existing
`data`/`groupPubKey`) → notify (added + removed). Mirrors `updateGroup` but with a delta instead of full
sets, and verifies the explicit delta in the payload.

### 1.5 Endpoint impact

On the client: build/sign the `modifyMembers` payload (with the delta fields), submit only affected members'
key entries on add, rotate + re-distribute on remove. Verification on read already handles `modifyMembers`
entries: replay applies the signed delta to the running member set and confirms it matches the served sets.

### 1.6 Status of the prototype

A working `modifyGroupMembers` (service method, RPC, validators, and tests) **exists on the `feat/group-api`
branch** from earlier work. It is **deferred from the current scope**, not the supported path. Options to keep
code and docs aligned (pick one when convenient):
- **Leave it dormant** — keep the code but treat full replace as the only documented/supported path (this doc
  is the record). Simplest; the code is tested and harmless.
- **Gate it** — hide the RPC behind a feature flag / capability so clients don't depend on it yet.
- **Remove it** — delete the method + validators + tests; reintroduce from this spec when prioritised.

---

## 2. Roadmap index (other deferred items)

These are designed elsewhere; collected here as the single "what's next" list. All 🟡.

| Item | Where it's specified |
|------|----------------------|
| Group key **epochs** (`keyVersion`/`keyHistory`), `generateNewGroupKey` | [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §2/§3 |
| Lazy re-key on write (cryptographic forward secrecy) | [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §3.4, [05-flows.md](./05-flows.md) §5c |
| Optimistic CAS on epoch + `ROTATED_ALREADY` winner-envelope | [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §4, [05-flows.md](./05-flows.md) §7 |
| Key-confirmation tag (anti garbage-key), rotation rate-limit | [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §5 |
| `GroupRole {READ, WRITE, PUSH}` (replace `ContainerRole`) | [03-data-model-and-consequences.md](./03-data-model-and-consequences.md) §6 |
| `checkpoint` op + incremental verification + Merkle transport | [02-bridge-api-contract.md](./02-bridge-api-contract.md) §7.1, [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §5.1 |
| History pruning via checkpoints | [03-data-model-and-consequences.md](./03-data-model-and-consequences.md) §7 |
| Full MLS forward-compatibility (lite-v1 → mls-v1 coexistence) | [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §8/§9 |
