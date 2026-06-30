# 01 — Architecture overview

> Status legend in [README.md](./README.md). ✅ implemented · 🟡 planned (MLS-lite) · 🔵 endpoint.

---

## 1. What a Group is

A **Group** is a context-scoped resource that plays two roles:

1. **A container (for its own lifecycle).** ✅ It has `users` (members), `managers`, an opaque encrypted
   `data` blob, a symmetric **data key** (`keyId`) distributed to members via the standard
   `KeyEntrySet[]`/`UserKeysEntry[]` mechanism — exactly like a thread. CRUD lives on `ContextApi`
   (`context.groupCreate`, `context.groupGet`, …). The bridge derives `version = history.length`, the same
   convention threads use.

2. **A grantee (for other containers).** ✅ A group has a **stable identity keypair**. The bridge stores only
   the public half — `groupPubKey` (plaintext, stable for the group's life). When a group is added to a
   thread/store/inbox/kvdb/stream, that container's content key is encrypted **once** to `groupPubKey`
   instead of once per member. Members holding the group's private key derive access without a per-user key
   entry on every container.

The bridge stays a **zero-knowledge blob store + access/coverage/signature enforcer**. It never sees private
keys. All crypto (group keypair generation, wrapping the group privkey to members, wrapping container keys to
`groupPubKey`, the membership-log signatures) is the **endpoint's** job.

> Groups **cannot** be members of other groups (no nesting). ✅ The `db.group.Group` document has no
> `groups`/`groupKeys` fields. This keeps access resolution one level deep.

---

## 2. The three-key hierarchy

```
user key            (asymmetric, one per user — the user's context identity keypair)
   │  wraps
   ▼
group private key   (asymmetric; groupPubKey is the public half, the grantee target)
   │  wraps
   ▼
container content key  CK  (symmetric, per container/keyId — encrypts the actual content)
```

Two distinct kinds of key entry carry the wrapping, and **they live in different documents**:

| Entry | What it carries | Wrapped to | Stored with | Type (API / DB) |
|-------|-----------------|------------|-------------|-----------------|
| **Group key entry** | the group's data key (and, in the endpoint design, the group privkey distribution) | each member's user pubkey | **the group** (`db.group.Group.keys`) | `KeyEntrySet` / `UserKeysEntry` |
| **Encryption key entry** | the container content key `CK` | the group's `groupPubKey` | **the container** (`thread.groupKeys`, …) | `GroupKeyEntrySet {group, keyId, data}` / `GroupKeysEntry {group, keys}` |

A member reading a group-granted container resolves: *my user key → (group key entry) → group privkey →
(encryption key entry) → CK → content*.

> **Naming note.** At the API boundary a container's per-group entry is `GroupKeyEntrySet {group, keyId,
> data}` (one wrapped blob). In the DB it is stored as `GroupKeysEntry {group, keys: KeyEntry[]}` (grouped by
> group). The bridge converts between them in `CloudKeyService.buildGroupKeys`. See
> [02-bridge-api-contract.md](./02-bridge-api-contract.md) and
> [03-data-model-and-consequences.md](./03-data-model-and-consequences.md).

---

## 3. Two role axes

There are two independent role concepts; do not conflate them:

- **Membership role inside a group** — who can *administer the group itself*. ✅ A group has `users` and
  `managers`; managers can update/modify-members/delete the group (enforced by ACL `context/group*` +
  `GroupPolicy`).
- **Grant role of a group on a container** — what the group's members may do *in that container*. ✅ Carried
  by `GroupGrant {groupId, role}` where `role: ContainerRole = "user" | "manager"`. A `"manager"` grant
  splices each group member into the container's `managers`; a `"user"` grant into `users`.

> 🟡 The plan is to migrate the grant role from `ContainerRole "user"|"manager"` to a richer
> `GroupRole {READ, WRITE, PUSH}` (per the SIMPLITO spec). The role-tagged `GroupGrant[]` shape was chosen
> precisely so this is a value change, not a shape change. See
> [03-data-model-and-consequences.md](./03-data-model-and-consequences.md) §6.

---

## 4. Security model: membership integrity in the endpoint DIO (bridge stores only)

The bridge is **untrusted**, so it does **not** sign or verify group data. `GroupMembershipSignature` and the
bridge-side `signature`/`prevSignature` fields were **removed**. Membership integrity is committed by the
endpoint **inside the opaque `data` blob** of each version, using the same `DataIntegrityObject` (DIO) every
module already uses, and is **verified client-side**. See
[10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md). ✅ (bridge)

- The endpoint's DIO binds the author (`creatorUserId`/`creatorPubKey`), context/resource, timestamp,
  per-field checksums, and — for groups — the **member set + a chain link to the prior version**, signed with
  the author's key (secp256k1 / SHA-256 / 65-byte compact ECDSA, the endpoint's existing primitive). Current
  scope covers `create` and full-replace `update`; the delta `modifyMembers` op is deferred ([08](./08-future-plans.md)).
- The chain link makes drops/reorders detectable: a missing version breaks the next link. It lives **inside
  `data`**, not as a bridge field.
- The **bridge** stores group state + the append-only `history` (each version's opaque `data`) and serves it
  back. It enforces ACL, key-coverage, the `version` optimistic-concurrency check, and `GROUP_IN_USE` — but it
  never inspects or verifies the DIO.
- On read, `groupGet`/`groupList` return the **whole history**; the endpoint replays genesis→head, verifies
  each version's DIO signature + chain link, confirms each signer was an authorized manager in the prior
  verified state, confirms the bridge-served `users`/`managers` match the DIO-committed set, and routes author
  identity through the endpoint's `UserVerifier`.

The exact canonical byte format is the single most important cross-repo contract; it is specified in
[02-bridge-api-contract.md](./02-bridge-api-contract.md) §7 and
[06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §4.

---

## 5. Revocation & forward secrecy model

Two layers, deliberately separated:

1. **Server-enforced revocation (immediate, O(1)).** ✅ A removed member is refused content and key entries
   the instant the group write commits. The bridge resolves the caller's group memberships live
   (`BaseContainerService.getCallerGroupIds`) and only serves group-granted containers / current key entries
   to current members.
2. **Cryptographic forward secrecy (lazy, per-container).** 🟡🔵 A removed member may still *hold* old keys.
   To make *new content* unreadable to them, the group key is rotated into a new **epoch** on removal, and
   each affected container is **re-keyed on its next write** (the endpoint wraps a fresh `CK` to the group's
   current epoch pubkey). Old content is never re-encrypted (you can't un-share the past).

> Consequence to internalise: **server access ⊇ cryptographic access** during the lazy window. Until a
> container is re-keyed, a just-removed member is *server-blocked* but, if they cached the old `CK`, could
> still read content they already had keys for. The two layers converge once the container is re-keyed.

The MLS-lite epoch machinery (`keyVersion`/`keyHistory`, `generateNewGroupKey`, the lazy-re-key-on-write
algorithm) is 🟡/🔵 and detailed in [../group-mls-lite-plan.md](../group-mls-lite-plan.md). What is ✅ today
is the server-enforced revocation layer and the single-`keyId` rotation via `groupUpdate` (full replace).

---

## 6. Layer map (mirrors the Thread stack)

```
context.groupCreate (RPC)  →  ContextApi              (✅ existing class, new @ApiMethod methods)
                              →  GroupService          (✅ new; modeled on ThreadService)
                                 →  GroupRepository    (✅ new; collection "group")        → db.group.Group
                                 →  CloudKeyService     (✅ extended: group key coverage)
                                 →  GroupPolicy         (✅ new; extends BasePolicy)
                                 →  CloudAclChecker     (✅ extended: context/group* actions)
                                 →  GroupNotificationService (✅ new; modeled on ThreadNotificationService)
                                 (GroupMembershipSignature — REMOVED; bridge verifies nothing. Integrity is in the
                                  endpoint DIO inside `data`, verified client-side. Doc 10 §3b.)

thread/store/inbox/kvdb/stream create/update  →  *Service (✅ accept groups/groupKeys grantees)
                                                 →  CloudKeyService.checkGroupKeysAndGrantees (✅)
                                                 →  BaseContainerService.withGroupMembership / getCallerGroupIds (✅)
                                                 →  ContextRepository scope/pagination filter ($elemMatch on groups) (✅)
```

Reused as-is: `BaseContainerService`, `BasePolicy`, `PolicyService`, `CloudAccessValidator`,
`RepositoryFactory.createObjectRepositoryFor`, `MongoDbManager.generateId`, `@ApiMethod`,
`ECUtils.verifySignature2`, and the `tv.eccSignature` validator.

---

## 7. What's implemented vs planned (at a glance)

| Capability | Status |
|------------|--------|
| Group CRUD on `ContextApi` (`context.group*`) | ✅ |
| Membership change via **full replace** (`groupUpdate`) | ✅ |
| Membership integrity committed in endpoint DIO (`data`), verified client-side; **bridge stores only** | ✅ |
| Delta membership modification (`groupModifyMembers`) | 🟡 deferred — [08](./08-future-plans.md) |
| Group-as-grantee on all 5 containers (`groups`/`groupKeys`) | ✅ |
| Role-tagged grant `GroupGrant {groupId, role:"user"\|"manager"}` | ✅ |
| Server-enforced revocation (`getCallerGroupIds`/`withGroupMembership`) | ✅ |
| Set-equality coverage check (anti-ghosting) on group + container keys | ✅ |
| `GROUP_IN_USE` referential-integrity guard on delete | ✅ |
| Context teardown cascade (`deleteGroupsByContext`) | ✅ |
| Group key **epochs** (`keyVersion`/`keyHistory`), `generateNewGroupKey` | 🟡 |
| Optimistic CAS on `keyVersion` + `ROTATED_ALREADY` winner-envelope | 🟡 |
| Key-confirmation tag, rotation rate-limit | 🟡 |
| `GroupRole {READ,WRITE,PUSH}` migration | 🟡 |
| Lazy re-key on write (forward secrecy) | 🟡🔵 |
| Endpoint library: keypair lifecycle, signing, chain verify, re-key | 🔵 |
| Backward-compatibility: all container grantee fields optional | ✅ (see doc 7) |
