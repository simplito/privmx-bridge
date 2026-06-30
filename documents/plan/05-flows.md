# 05 — All flows

> Status legend in [README.md](./README.md). Each flow gives the actors, a sequence diagram, and the exact
> step list (with the bridge checks and error codes from doc 02/04). ✅ unless tagged 🟡/🔵.
> "EP" = endpoint (client). "BR" = bridge. "DB" = mongo.

Conventions used below:
- `Uk` = a user's context keypair (`Uk.pub` is `userPubKey`). `GK` = group keypair (`GK.pub` = `groupPubKey`).
- `CK` = container content key (symmetric), versioned by `keyId`.
- "group key entry" = `GK.priv`/data-key wrapped to a member's `Uk.pub`, stored **on the group**.
- "encryption key entry" = `CK` wrapped to `GK.pub`, stored **on the container**.

---

## 1. Create group ✅

> **Updated for the store-only design** (GroupMembershipSignature dropped — doc [10](./10-endpoint-security-model-and-alignment.md) §3b): there is no `signature` field and the bridge verifies nothing; the membership proof (author signature + member set + `prevEntryHash` chain link) is committed **inside the endpoint DIO in `data`** and verified client-side.

```mermaid
sequenceDiagram
  participant EP as Endpoint (creator)
  participant BR as Bridge ContextApi
  participant GS as GroupService
  participant DB
  EP->>EP: generate GK (identity) + Gk (data key); build group `data` = DIO{publicMeta, privateMeta, groupPrivKey, membership:{users,managers,groupPubKey,keyId,prevEntryHash:null}} signed by creator
  EP->>EP: wrap Gk (data key) to each member's Uk.pub → keys[]
  EP->>BR: context.groupCreate { groupPubKey, users, managers, data, keyId, keys[] }
  BR->>GS: createGroup(...)
  GS->>GS: ACL context/groupCreate; policy.makeCreateContainerCheck
  GS->>GS: cloudKeyService.checkKeysAndUsersDuringCreation (coverage)
  GS->>DB: createGroup (genesis history entry; stores `data` opaquely — NO signature check)
  GS->>BR: { groupId }
  GS-->>EP: groupCreated event (to users+managers)
  BR-->>EP: { groupId }
```

Steps: (1) EP generates the group identity keypair + data key and builds the DIO-signed `data` (commits the
member set + genesis chain link, see [../endpoint_phase_one/02-keys-and-integrity.md](../endpoint_phase_one/02-keys-and-integrity.md)).
(2) wraps the data key to members → `keys[]`. (3) `context.groupCreate` (no `signature`). (4) BR: ACL → policy
→ coverage → **store opaquely** → notify (no verification). (5) Returns `groupId`. **Errors:** `ACCESS_DENIED`,
`DUPLICATE_RESOURCE_ID`, `INVALID_PARAMS`, `USER_DOESNT_EXIST`.

---

## 2. Get group & verify the chain ✅ (BR) / 🔵 (verification)

```mermaid
sequenceDiagram
  participant EP as Endpoint
  participant BR as Bridge
  EP->>BR: context.groupGet { groupId }
  BR-->>EP: GroupInfo { history[] (version records), data[] (DIO blobs), users, managers, groupPubKey, keys (filtered to me) }
  EP->>EP: replay genesis→head over data[]: verify each version's DIO signature
  EP->>EP: verify chain link: membership[i].prevEntryHash == sha256(data[i-1])
  EP->>EP: verify each signer was an authorized manager in the prior verified state
  EP->>EP: verify DIO-committed member set == bridge-served history[i].users/managers
  EP->>EP: UserVerifier.verify(every distinct signer); decrypt my Gk entry → data → GroupPriv
```

The bridge serves the whole `history` + per-version `data` (the DIO blobs). Verification is **entirely the
client's** job (the bridge verifies nothing); any mismatch is a tamper error. Full algorithm:
[../endpoint_phase_one/03-verification.md](../endpoint_phase_one/03-verification.md) and
[06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §5.

> Full genesis→head replay is O(history length) and is only required on first sight. In steady state the
> client compares the served head DIO-entry hash to its cached verified head (O(1)) and verifies only new tail
> entries; signed `checkpoint`s (now DIO-committed) bound the cold-start cost. See
> [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §5.1 (🟡 incremental verification).

---

## 3. Add members (full replace via `groupUpdate`) ✅

```mermaid
sequenceDiagram
  participant EP as Endpoint (manager)
  participant BR as Bridge
  participant DB
  EP->>BR: context.groupGet { groupId }   (get + verify current state, head DIO hash)
  EP->>EP: newUsers = oldUsers ∪ added; build new `data` = DIO{..., membership:{newUsers,...,prevEntryHash:headHash}}
  EP->>EP: wrap group data-key to EVERY member → full keys[]
  EP->>BR: context.groupUpdate { id, groupPubKey, users:newUsers, managers, data, keyId, keys[] (full), version, force:false }
  BR->>BR: ACL context/groupUpdate; version check (optimistic concurrency) ❌→GROUP_VERSION_MISMATCH
  BR->>BR: coverage checkKeysAndClients (set-equality over full member set)
  BR->>DB: append "update" history entry (stores `data` opaquely — NO signature/chain check)
  BR-->>EP: OK; groupUpdated event (added members included)
```

New members immediately read **every container the group is a grantee of** — those `CK`s are already wrapped
to the unchanged `GK.pub`. **Containers are untouched.** Cost: full replace re-sends the **entire** key set
(O(all members)) even to add one member — the deferred delta path
([08-future-plans.md](./08-future-plans.md) §1) would send only the new members' entries. (🟡 With epochs,
adding does not bump the epoch.)

---

## 4. Remove members ✅ (server revocation) + 🟡🔵 (forward secrecy via epoch + lazy re-key)

```mermaid
sequenceDiagram
  participant EP as Endpoint (manager)
  participant BR as Bridge
  participant DB
  EP->>EP: newUsers = oldUsers minus removed
  Note over EP: 🟡 generate fresh GK' (new epoch v+1); wrap to REMAINING members only
  EP->>EP: build new `data` = DIO{..., membership:{remaining,...,prevEntryHash:headHash}} signed by manager
  EP->>BR: context.groupUpdate { id, groupPubKey('), users:newUsers, ..., keyId', keys'[] (remaining), version, force:false }
  BR->>BR: ACL; version check; coverage (set-equality: remaining members only) — NO signature/chain check
  BR->>DB: append "update" entry; 🟡 set groupPubKey=GK'.pub, keyVersion=v+1, push old pub to keyHistory
  BR-->>EP: OK; groupUpdated event (removed members included → their clients drop state)
  Note over BR: removed member is SERVER-BLOCKED immediately (getCallerGroupIds no longer returns this group)
  Note over EP,BR: containers NOT re-keyed here — that is lazy, on next write (§5)
```

Two effects:
- **Immediate (✅):** the bridge stops returning the group in `getCallerGroupIds` for the removed user, so it
  refuses them group-granted containers and current key entries at once.
- **Forward secrecy of new content (🟡🔵):** the removed user may still hold the old `GK.priv`/`CK`. New
  content becomes unreadable to them only after (a) the group epoch is bumped (🟡) and (b) each affected
  container is re-keyed on its next write (§5). Old content is never re-encrypted.

> Today (✅, pre-epoch): a removal is a `groupUpdate` (full replace) with a rotated data `keyId`; remaining
> members get a fresh full `keys` set, the removed member loses server access. The cryptographic FS of
> *container* content is the 🟡🔵 lazy re-key. The server-revocation guarantee is fully live today.

---

## 5. Grant a group to a container, read it, and lazy re-key ✅ grant/read · 🟡🔵 re-key

### 5a. Grant (create or update a container with a group grantee) ✅

```mermaid
sequenceDiagram
  participant EP as Endpoint (container manager)
  participant BR as Bridge (e.g. ThreadApi)
  participant DB
  EP->>BR: context.groupGet { groupId }   (need current groupPubKey)
  EP->>EP: wrap container CK(keyId) to group.groupPubKey → GroupKeyEntrySet {group, keyId, data}
  EP->>BR: thread.threadCreate/Update { ..., groups:[{groupId, role}], groupKeys:[{group, keyId, data}] }
  BR->>BR: checkGroupKeysAndGrantees: groups exist; SET-EQUALITY coverage for keyId ❌→INVALID_PARAMS
  BR->>DB: store container with groups[] + groupKeys[]
  BR-->>EP: OK
```

### 5b. Read a group-granted container ✅ (BR access) / 🔵 (decrypt)

```mermaid
sequenceDiagram
  participant EP as Endpoint (group member)
  participant BR as Bridge
  EP->>BR: thread.threadGet { threadId }
  BR->>BR: getCallerGroupIds(contextId, me); withGroupMembership splices me into users/managers
  BR->>BR: BasePolicy.getPolicyUser → access granted (as if direct member)
  BR-->>EP: ThreadInfo { ..., groupKeys:[{group, keys}] }
  EP->>EP: my group-key entry → GK.priv → unwrap encryption key entry → CK → decrypt content
```

### 5c. Lazy re-key on write (forward secrecy) 🟡🔵

```mermaid
sequenceDiagram
  participant EP as Endpoint (writer)
  participant BR as Bridge
  EP->>BR: context.groupGet for each grantee group (read current epoch)
  EP->>EP: stale = any grantee g where container.groupKeys(g).groupEpoch < g.currentEpoch
  alt stale or policy=always-rotate
    EP->>EP: CK' = fresh; keyId'; wrap CK' to each grantee group's CURRENT groupPubKey + each direct user
    EP->>EP: confTag = MAC_CK'("confirm"||keyId')
    EP->>BR: thread.threadUpdate { keyId', groups[], groupKeys'[], keys'[], (confTag) }
    BR->>BR: set-equality coverage on keyId'; (🟡 CAS on container keyId/generation)
    BR-->>EP: OK (or 🟡 ROTATED_ALREADY + winner envelope → adopt + retry)
  else fresh
    EP->>EP: reuse current CK
  end
```

Key facts: re-key wraps to each grantee group's **current** epoch pubkey, so one write enforces the latest
membership of *all* grantee groups at once; it is one wrap **per grantee group** (not per member); old content
keeps the old `CK`. Full algorithm + hardening in
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §3.4/§5.

---

## 6. Group membership change ↔ container consistency (the E2E limitation) ✅ contract

When a group's membership changes, the **effective audience** of every container that grants to that group
changes — but **the bridge cannot re-encrypt those containers' `CK`s** (zero-knowledge). The division of
responsibility:

| Responsibility | Owner |
|----------------|-------|
| Refuse removed members server-side (immediately) | ✅ Bridge (`getCallerGroupIds`) |
| Emit `groupUpdated` to members (incl. removed) | ✅ Bridge |
| Re-key affected containers for forward secrecy | 🔵 Endpoint (lazy, §5c, or eager) |
| Distribute new `GK` epoch keys to remaining members | 🔵 Endpoint |

The bridge does **not** emit events on the *containers'* channels for a group change — a client reconciling
must, on `groupUpdated`, find the containers the group grants into (🟡 a "containers a group grants into"
query helps eager mode; lazy mode needs nothing). See
[06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §6.

---

## 7. Concurrent rotation (optimistic CAS + winner-envelope retry) 🟡

```mermaid
sequenceDiagram
  participant A as Endpoint A
  participant B as Endpoint B
  participant BR as Bridge
  A->>BR: rotate { expectedVersion: v, keys' }
  B->>BR: rotate { expectedVersion: v, keys'' }
  BR->>BR: atomic CAS: update where keyVersion=v → v+1
  BR-->>A: OK (A wins; routes A's envelopes)
  BR-->>B: ROTATED_ALREADY { winnerEnvelopeForB }   (B loses)
  B->>B: verify winner's signature; decrypt own envelope; adopt epoch v+1
  B->>BR: retry original op (e.g. sendMessage) — no extra round trip, no re-generate
```

The winner's envelope in the rejection is **signed by the winner** and **wrapped to the loser's pubkey**, so a
malicious bridge can neither forge nor substitute it. The membership-log chain still provides
integrity/authorization on top of the integer CAS. Detail: [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §4.

---

## 8. Full update (rotate pubkey / replace sets) ✅

`context.groupUpdate` replaces `users`/`managers`/`data`/`keyId`/`keys`/`policy` and may rotate
`groupPubKey`. Uses optimistic `version` (= `history.length`) + `force`, **and** the `prevSignature` chain
link. If `groupPubKey` is rotated, treat all containers granting to the group as stale → they must be
re-keyed (same as §5c). Steps mirror §3/§4 but with full sets instead of a delta.

---

## 9. Delete group ✅

```mermaid
sequenceDiagram
  participant EP as Endpoint (manager)
  participant BR as Bridge
  EP->>BR: context.groupDelete { groupId }
  BR->>BR: ACL context/groupDelete; policy.canDeleteContainer
  BR->>BR: isGroupReferenced on thread/store/inbox/kvdb/stream
  alt referenced anywhere
    BR-->>EP: GROUP_IN_USE
  else not referenced
    BR->>BR: deleteGroup; sendDeletedGroup event
    BR-->>EP: OK
  end
```

Operational order: remove the group from all containers (`*Update` dropping it from `groups`/`groupKeys`)
**before** deleting it, else `GROUP_IN_USE`.

---

## 10. Context teardown & user removal ✅

- **`deleteContext`** cascades: `groupService.deleteGroupsByContext(contextId, solution)` deletes every group
  in the context (batched 100 at a time, each notified) alongside thread/store/inbox/stream teardown.
- **`removeUserFromContext`** removes the context-user row + notifies, but **does not** prune the user from
  groups. Consequence (doc 03 §4.3): the user remains listed in `group` docs but is gated by the live access
  check (no longer a context user). A manager should run `groupUpdate` (full replace) to clean + re-key. No automatic
  group mutation occurs here.

---

## 11. Error / negative flows ✅ (test-backed)

> **Updated for the store-only design** (doc [10](./10-endpoint-security-model-and-alignment.md) §3b): the
> bridge no longer verifies signatures, so the signature/chain-link error rows below were **removed** — those
> failures are now **client-side tamper errors** surfaced via `statusCode`, detected by the endpoint's
> history-replay verification ([../endpoint_phase_one/03-verification.md](../endpoint_phase_one/03-verification.md)),
> not bridge errors. `GROUP_VERSION_MISMATCH` is now strictly the optimistic-concurrency check.

| Scenario | Result | Why |
|----------|--------|-----|
| Update with stale `version`, `force=false` | `GROUP_VERSION_MISMATCH` | version optimistic-concurrency check |
| Delete group still granted to a thread | `GROUP_IN_USE` | `isGroupReferenced` |
| Grant a group but omit its key for `keyId` | `INVALID_PARAMS` | set-equality coverage (anti-ghosting) |
| Grant an extra/unknown group | `INVALID_PARAMS` / `GROUP_DOES_NOT_EXIST` | coverage / existence |
| No `context/groupCreate` ACL | `ACCESS_DENIED` | ACL |
| Tampered membership / broken chain / unauthorized signer | client tamper error (`statusCode`≠0) | **endpoint** DIO replay (G1/G2/G3), not a bridge error |

See [../../src/test/end2end/CloudTests/MainGroupApiTest.test.ts](../../src/test/end2end/CloudTests/MainGroupApiTest.test.ts)
(the signature/chain e2e cases were replaced by a version-CAS test when GroupMembershipSignature was dropped).
