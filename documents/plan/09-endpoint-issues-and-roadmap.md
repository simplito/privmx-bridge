# 09 — Checkpoint, endpoint issues & next-phase roadmap

> Status legend in [README.md](./README.md). This doc is the **handoff**: what the bridge provides *today*,
> what the **privmx-endpoint** (C++ client) must build to make groups usable end-to-end (Phase 1 parity),
> and the **next phase** (epochs + forward secrecy) as issues across both repos.
>
> Issues use IDs `EP-n` (endpoint) and `BR-n` (bridge). Each is self-contained; copy into your tracker.
>
> **⚠️ SUPERSEDED IN PART by the dedicated phase directories.** Since this doc was written, the per-phase
> implementation guides were added and are now **authoritative**: [../endpoint_phase_one/](../endpoint_phase_one/)
> (Phase-1 endpoint), [../bridge_phase_two/](../bridge_phase_two/) + [../endpoint_phase_two/](../endpoint_phase_two/)
> (Phase 2). Also, `GroupMembershipSignature` was **dropped** (doc 10 §3b) — so any issue below describing a
> `PMX_GROUP_SIG` canonical signing format, `signature`/`prevSignature` fields, or a `GroupSignatureOp`
> reflects the *old* design; read those as "commit the proof in the endpoint DIO inside `data`" per the phase
> dirs. The issue *intent* still holds; the *signing mechanism* changed.

---

## 0. Checkpoint — state as of this branch (`feat/group-api`)

### 0.1 Bridge — what works today ✅
Verified by `tsc` (0), `eslint` (0), and unit suites (`GroupService` 8/8, `MainContextApiValidator` 6/6).
*(The `GroupMembershipSignature` suite was deleted with the module; the e2e signature/chain tests were
replaced by a version-CAS test.)*

| Capability | Notes |
|------------|-------|
| `context.group{Create,Update,Delete,Get,List}` | full CRUD on `ContextApi`; contract in [02-bridge-api-contract.md](./02-bridge-api-contract.md) |
| Membership change via **full replace** (`groupUpdate`) | swap whole `users`/`managers` + whole key set; `version` + `force` (no `signature`/`prevSignature` — dropped) |
| Membership integrity | **committed in the endpoint DIO inside `data`, verified client-side**; the bridge stores it but does NOT sign/verify (GroupMembershipSignature dropped — see [10](./10-endpoint-security-model-and-alignment.md) §3b). Bridge keeps append-only version `history` so the client can replay the DIO chain. `version` optimistic-concurrency only (`GROUP_VERSION_MISMATCH`). |
| Group-as-grantee on all 5 containers | `groups: GroupGrant[]` + `groupKeys`; role-tagged `{groupId, role:"user"\|"manager"}` |
| Server-enforced revocation | `getCallerGroupIds` / `withGroupMembership`; `$elemMatch` scope/pagination filter |
| Set-equality coverage (anti-ghosting) | `CloudKeyService.checkGroupKeysAndGrantees` / `verifyThatOnlyGivenGroupsHaveAccess` |
| `GROUP_IN_USE` referential guard | delete blocked while group is a grantee of any container |
| Context teardown cascade | `deleteGroupsByContext` on `deleteContext` |
| Backward-compat | container `groups`/`groupKeys` optional in validators + DB (doc 07) |

### 0.2 Bridge — what is NOT present yet ❌
- `context.groupModifyMembers` (delta) — **deferred**; service method dormant ([08-future-plans.md](./08-future-plans.md) §1).
- Key **epochs** (`keyVersion`/`keyHistory`), `generateNewGroupKey`, optimistic CAS + `ROTATED_ALREADY`,
  key-confirmation tag, rotation rate-limit — **Phase 2 below**.
- **DB index migration** for the `group` collection and the container `groups.groupId` index — **missing**
  (confirmed: no `Migration0NN` references `group`). Tracked as **BR-0** (blocker). Functionally the feature
  works (Mongo lazy-creates the collection) but membership queries scan.

### 0.3 Endpoint — state
**Nothing implemented.** The bridge is zero-knowledge; until the endpoint exists, groups cannot be used
end-to-end. Phase 1 (EP-1…EP-8) brings the endpoint to parity with the bridge above.

### 0.4 The end-to-end gap, in one line
*Bridge stores, orders, and enforces coverage/signatures on opaque blobs. The endpoint generates all keys,
signs all ops, wraps all container keys, and verifies the log. No client ⇒ no usable feature.*

---

## Phase 1 — Endpoint parity with the current bridge

Goal: a member can create groups, change membership (full replace), grant groups to containers, read
group-granted containers, and verify the membership log — against today's bridge, no protocol changes.

Issue template: **Repo · Depends on · Bridge contract · Description · Tasks · Acceptance criteria.**

---

### EP-1 — Group keypair lifecycle + `group::GroupApi` CRUD
**Repo:** endpoint · **Depends on:** — · **Bridge contract:** [02](./02-bridge-api-contract.md) §2–§6, [06](./06-endpoint-client-guide.md) §1–§3

**Description.** Implement `group::GroupApi` mapping to `context.group{Create,Update,Delete,Get,List}`. On
`createGroup`, generate the group identity keypair `GK`; send `GK.pub` as `groupPubKey` (cleartext, stable);
encrypt `publicMeta`/`privateMeta` into `data` keyed by the group data key (`keyId`) — reuse existing
container-data machinery. Distribute the group data key to members via `keys: KeyEntrySet[]`.

**Tasks.**
- [ ] Generate + manage `GK` (the asymmetric group identity keypair).
- [ ] `createGroup` / `updateGroup` / `deleteGroup` / `getGroup` / `listGroups` wrappers.
- [ ] Encrypt/decrypt `data` with the group data key; pack member key entries.
- [ ] Surface `groupId` from create.

**Acceptance criteria.**
- Round-trip: create → get → list returns the group; `data` decrypts; `groupPubKey` stable.
- `deleteGroup` returns `GROUP_IN_USE` when the group still grants into a container (handled, surfaced).

---

### EP-2 — Membership-log signing (canonical bytes, **must match the bridge byte-for-byte**)
**Repo:** endpoint · **Depends on:** EP-1 · **Bridge contract:** [02](./02-bridge-api-contract.md) §7, [groupMembershipSignature.md](../groupMembershipSignature.md)

**Description.** On every `create` and `update` (current ops; `modifyMembers` is deferred), build the
canonical payload and sign it with the acting **manager's context private key**. Domain `"PMX_GROUP_SIG"`,
version `"1"`, fields in fixed order: `op, contextId, author, authorPubKey, groupPubKey, keyId,
prevSignature("" for genesis), resultUsers, resultManagers`. Encoding: each string =
`uint32be(len)||utf8`; each list = `uint32be(count)||sorted-elements` (**sorted ascending by UTF-8 bytes**);
`digest = sha256(canonical)`; signature = 65-byte compact ECDSA (recovery||r||s), Base64. `prevSignature` =
current head entry's `signature`.

**Tasks.**
- [ ] Canonical serializer (byte-exact); sha256; compact-ECDSA sign.
- [ ] Chain: pass `signature` + (for update) `prevSignature` = head.
- [ ] Anchor on `groupPubKey`, **never** the server `groupId`.

**Acceptance criteria.**
- A create/update accepted by the bridge (no `INVALID_SIGNATURE` / `GROUP_VERSION_MISMATCH`).
- Cross-repo test vectors (see EP-6) match.

---

### EP-3 — Membership-log verification on read (the security boundary)
**Repo:** endpoint · **Depends on:** EP-2 · **Bridge contract:** [06](./06-endpoint-client-guide.md) §5

**Description.** On `getGroup`/`listGroups`, replay `history` genesis→head: verify each `signature` vs its
`authorPubKey`; verify each `prevSignature` links to the prior entry; verify each signer was an authorized
manager **in the state prior to that entry**; verify the replayed member set equals the served
`users`/`managers` and that `groupPubKey`/`keyId` match the head. Any failure ⇒ tamper error (no silent
fallback).

**Tasks.**
- [ ] Replay + per-entry verification.
- [ ] Inductive manager-authority check from the chain (not current membership).
- [ ] **Incremental verification (recommended):** cache `{verifiedHeadSignature, verifiedMembers,
      verifiedManagers, verifiedGroupPubKey}`; compare served head signature (O(1)); verify only the new tail;
      reject if cached head is not an ancestor (fork detection). Cache only — full replay on miss
      ([06](./06-endpoint-client-guide.md) §5.1). *(Checkpoints/Merkle are 🟡 future — out of Phase 1.)*

**Acceptance criteria.**
- Tampered member set / forged signature / broken chain ⇒ raised as tamper error.
- Steady-state read with unchanged head does **0** signature verifications.

---

### EP-4 — Group-as-grantee in container APIs (thread/store/inbox/kvdb/stream)
**Repo:** endpoint · **Depends on:** EP-1 · **Bridge contract:** [02](./02-bridge-api-contract.md) §8, [06](./06-endpoint-client-guide.md) §6–§7

**Description.** Extend each container `create`/`update` to accept `groups: [{groupId, role}]` and
`groupKeys: [{group, keyId, data}]` (`GroupKeyEntrySet`). When adding a group, `getGroup` for its current
`groupPubKey`, wrap the container content key `CK` to it, submit in `groupKeys`. On read, resolve *my group
key entry → `GK.priv` → encryption key entry → `CK` → content*.

**Tasks.**
- [ ] Add `groups`/`groupKeys` to all 5 container create/update clients.
- [ ] Wrap `CK` to `groupPubKey`; build `GroupKeyEntrySet`.
- [ ] Decrypt-path resolution via the group private key.
- [ ] Honour bridge **set-equality coverage**: exactly one entry per current grantee group for the `keyId`.

**Acceptance criteria.**
- A user who is *only* a group member can `get`/`list` and **decrypt** a group-granted container.
- Missing/extra group key ⇒ bridge `INVALID_PARAMS` (handled).

---

### EP-5 — Membership changes via full replace (`groupUpdate`)
**Repo:** endpoint · **Depends on:** EP-2 · **Bridge contract:** [05](./05-flows.md) §3–§4

**Description.** Since `modifyMembers` is deferred, implement add/remove as **full replace**:
- **Add:** `newUsers = old ∪ added`; wrap the group data key to **every** member (full `keys`); `op:"update"`.
- **Remove:** `newUsers = old − removed`; rotate the data `keyId`; wrap to **remaining** members only;
  `op:"update"`. (Server-blocks the removed member immediately; container forward secrecy is Phase 2.)
- Always pass `version` (= `history.length`) + `prevSignature` = head.

**Tasks.**
- [ ] Compute resulting sets locally; build full key set.
- [ ] Handle `GROUP_VERSION_MISMATCH` ⇒ re-`getGroup`, rebuild against new head, retry.

**Acceptance criteria.**
- Adding/removing a member succeeds; removed member loses server access on next call.
- Concurrent updaters: loser gets `GROUP_VERSION_MISMATCH` and retries cleanly.

---

### EP-6 — Shared canonical-signature test vectors (CI on both repos)
**Repo:** endpoint + bridge · **Depends on:** EP-2 · **Bridge contract:** [06](./06-endpoint-client-guide.md) §4

**Description.** Fixed-key + fixed-payload vectors (canonical hex, sha256 hex, signature) asserted in CI on
**both** repos so any serializer divergence fails fast. This is the single highest correctness risk.

**Tasks.**
- [ ] Author vectors for `create` and `update` (incl. empty and unsorted member lists).
- [ ] Assert in endpoint CI; mirror the existing bridge `GroupMembershipSignature.test`.

**Acceptance criteria.**
- Identical canonical bytes + digest + accepted signature across repos.

---

### EP-7 — Backward-compat / capability handling
**Repo:** endpoint · **Depends on:** EP-1, EP-4 · **Bridge contract:** [07](./07-backward-compatibility-and-migration.md)

**Description.** Treat container `groups`/`groupKeys` as possibly **absent** (old container/peer) ⇒ behave as
today (direct-user keys). If a container is reachable only via a group the client can't key ⇒ surface
"no access / update required", never crash. Advertise group support in the version handshake so apps gate
group-only grants until all readers are new.

**Tasks.**
- [ ] Null-safe handling of absent grantee fields.
- [ ] Graceful "needs newer client" surfacing (server-access ⊇ crypto-access edge, doc 07 §5).
- [ ] Capability advertisement.

**Acceptance criteria.**
- New client reads old containers unchanged; old containers convert to empty grantee sets.
- Mixed container (direct users + group) readable by both old (direct key) and new (either) clients.

---

### EP-8 — Error mapping
**Repo:** endpoint · **Depends on:** EP-1 · **Bridge contract:** [02](./02-bridge-api-contract.md) §9

**Description.** Map bridge errors to library exceptions: `GROUP_DOES_NOT_EXIST`, `GROUP_IN_USE`,
`GROUP_VERSION_MISMATCH`, `INVALID_SIGNATURE`, `DUPLICATE_RESOURCE_ID`, `ACCESS_DENIED`, `INVALID_PARAMS`,
`INVALID_KEY_ID`, `USER_DOESNT_EXIST`. On `GROUP_VERSION_MISMATCH` (write) ⇒ refresh + retry. On
chain-verification failure (read) ⇒ tamper error.

**Acceptance criteria.** Each code surfaces a distinct, documented exception; retry path works.

---

### Phase 1 dependency order
`EP-1 → EP-2 → {EP-3, EP-5, EP-6} ; EP-1 → EP-4 → EP-7 ; EP-8 alongside.`
Bridge **BR-0 (index migration)** should land before load testing but does not block functional integration.

---

## Phase 2 — Key epochs & cryptographic forward secrecy

Adds: **key epochs/`keyVersion`**, **`generateNewGroupKey`**, **optimistic CAS + `ROTATED_ALREADY`**,
**key-confirmation tag**, **rotation rate-limit**, **lazy re-key on write**. This phase requires **bridge +
endpoint** changes; endpoint issues depend on the matching bridge issue. Full design:
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §2–§5, [05](./05-flows.md) §4/§5c/§7.

What this buys: **forward secrecy of new container content after a removal** (removed members can't read
post-removal content) and **clean concurrent rotation**. It does **not** add PCS (see
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §7–§8).

### Bridge prerequisites

#### BR-1 — Group epochs (`keyVersion` / `keyHistory`) + epoch-tagged container entries
**Repo:** bridge · **Depends on:** —
**Description.** Add `keyVersion: number` (epoch) + `keyHistory: GroupPubKey[]` (past pubkeys) to
`db.group.Group`. Tag each container `groupKeys` entry with the `groupEpoch` its `CK` was wrapped under
(so clients detect staleness). Pre-epoch groups ⇒ treat as epoch 1; pre-epoch container entries ⇒ "matches
current" (additive, non-breaking — doc 07 §8).
**Acceptance.** New + existing groups/containers carry/imply an epoch; reads expose it.

#### BR-2 — `context.generateNewGroupKey`
**Repo:** bridge · **Depends on:** BR-1
**Description.** New `@ApiMethod` + `GroupService.generateNewGroupKey`: mint a new epoch keypair without a
membership delta (compromise recovery). Extend `GroupSignatureOp` with `"rekey"`; append a signed `rekey`
history entry binding the new `groupPubKey` + epoch; bump `keyVersion`; push old pub to `keyHistory`.
**Acceptance.** Epoch bumps; remaining members get new-epoch group key entries; signed log verifies.

#### BR-3 — Optimistic CAS on `keyVersion` + `ROTATED_ALREADY`
**Repo:** bridge · **Depends on:** BR-1
**Description.** Make the epoch the concurrency token. Rotation writes become a conditional update
`where keyVersion = expected → expected+1`. On miss, respond **`ROTATED_ALREADY`** (new error code) carrying
the winning epoch's group key entry **addressed to the caller** (signed by the winner, wrapped to the loser's
pubkey). Replaces bare `GROUP_VERSION_MISMATCH` on the rotation path.
**Acceptance.** Exactly one concurrent rotator wins; losers receive a verifiable winner envelope.

#### BR-4 — Rotation rate-limit + manager-only authority
**Repo:** bridge · **Depends on:** —
**Description.** Only managers may rotate (ACL already gates `context/groupUpdate`); auto-rotation fires only
on hard roster changes; rate-limit manual rotations per `(group, actor)` (anti-spam, doc-MLS-lite §5).
**Acceptance.** Spam rotations throttled; organic rotations unaffected.

#### BR-5 — Per-epoch coverage on re-key
**Repo:** bridge · **Depends on:** BR-1
**Description.** Extend `verifyThatOnlyGivenGroupsHaveAccess` / coverage to assert per-epoch coverage on
re-key writes (it already enforces set-equality for the current key).
**Acceptance.** Re-key rejected unless exactly the current grantees/members are covered for the new epoch/keyId.

### Endpoint issues

#### EP-9 — Epoch bookkeeping
**Repo:** endpoint · **Depends on:** BR-1, EP-1
**Description.** Maintain per group: current `epoch`, current `groupPubKey`, and the set `{epoch → GK.priv}`
for epochs this member is entitled to (decrypted from epoch-tagged group key entries). All **rebuildable**
from the bridge — no mandatory persistence, no replay ([06](./06-endpoint-client-guide.md) §2).
**Acceptance.** After offline through N epochs, the client rebuilds entitled epoch keys by re-fetching.

#### EP-10 — Epoch bump on removal + `generateNewGroupKey`
**Repo:** endpoint · **Depends on:** BR-2, EP-5, EP-9
**Description.** On removal (full-replace) and on explicit `generateNewGroupKey`, mint a **fresh random**
epoch keypair `GK'` (NOT derived from the old key), wrap `GK'.priv` to **remaining** members, sign the
`update`/`rekey` log entry binding new pubkey + epoch.
**Acceptance.** Removed members hold only ≤ old epoch keys; remaining members get epoch v+1.

#### EP-11 — `ROTATED_ALREADY` handling
**Repo:** endpoint · **Depends on:** BR-3, EP-9
**Description.** Catch `ROTATED_ALREADY`: verify the winner's signature, decrypt the included envelope
addressed to you, adopt the new epoch key, **retry** the original op — no extra round trip, no
re-generation ([05](./05-flows.md) §7).
**Acceptance.** Concurrent rotators converge; loser retries with the winner's key, no second key fetch.

#### EP-12 — Key-confirmation tag
**Repo:** endpoint · **Depends on:** EP-9 (and BR side that stores/forwards the tag)
**Description.** On rotation/re-key, emit `MAC_{newKey}("confirm"||epoch|keyId)`. Recipients **verify** their
decrypted key equals the canonical one **before** adopting (proactive anti garbage-key; cheap stand-in for
MLS `confirmation_tag`, doc-MLS-lite §5).
**Acceptance.** A garbage key handed to one recipient is detected at adoption, not at first decrypt failure.

#### EP-13 — Lazy re-key on write (the core new algorithm)
**Repo:** endpoint · **Depends on:** BR-1, BR-5, EP-9, EP-4
**Description.** On a write to a group-granted container: detect staleness (`container.groupKeys(g).groupEpoch
< g.currentEpoch`); if stale (or policy=always-rotate), mint `CK'`/`keyId'`, wrap `CK'` to each grantee
group's **current** `groupPubKey` + each direct user, emit a confirmation tag (EP-12), submit one container
write. Old content keeps the old `CK` ([05](./05-flows.md) §5c, doc-MLS-lite §3.4).
**Acceptance.** After a member is removed from a granting group, the next write to a container excludes them
from new content; one write covers all grantee groups' latest membership.

#### EP-14 — Epoch-tagged encryption-key-entry selection on read
**Repo:** endpoint · **Depends on:** BR-1, EP-9
**Description.** On read, pick an encryption key entry for a group I belong to, read its `groupEpoch e`, take
`GK.priv_e` from my epoch-key set (held iff I was a member at `e`), unwrap → `CK` → decrypt.
**Acceptance.** A member added at epoch v cannot read pre-v content unless explicitly given history keys
(history policy, [06](./06-endpoint-client-guide.md) §... / doc-MLS-lite §3.5).

### Phase 2 dependency order
`BR-1 → {BR-2, BR-3, BR-5} ; BR-4 standalone.`
`EP-9 → {EP-10(BR-2), EP-11(BR-3), EP-13(BR-1,BR-5), EP-14} ; EP-12 alongside EP-13.`

---

## 10. Definition of done

- **Phase 1 done** ⇒ a member can, against today's bridge: create groups, change membership (full replace),
  grant groups to containers, read+decrypt group-granted containers, and detect any membership-log tampering.
  Plus **BR-0** (index migration) for production.
- **Phase 2 done** ⇒ removing a member makes post-removal content cryptographically unreadable to them (lazy
  re-key), concurrent rotations converge via CAS, and garbage-key/weak-entropy/spam are mitigated. Still **no
  PCS** (accepted; see [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §7–§9 for the MLS path if PCS
  becomes required).
