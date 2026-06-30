# PrivMX Groups — Suggested Architecture, Flows & Glossary

> **⚠️ Historical design-synthesis — read with two later decisions in mind.** (1) **GroupMembershipSignature
> dropped** (plan/10 §3b): the bridge stores group `data` opaquely and verifies nothing; membership integrity
> is committed in the endpoint DIO inside `data` and verified client-side — so any "signed membership log /
> the bridge verifies / `prevSignature` chain" wording here is stale. (2) **Phasing**: key **versions/epochs**,
> **`generateNewGroupKey`/rotate**, and **lazy re-encryption** (e.g. §4, §7.4) are the *current Phase 2*
> (**planned, not implemented**) — specified in [bridge_phase_two/](./bridge_phase_two/) +
> [endpoint_phase_two/](./endpoint_phase_two/). The glossary and the create/add/remove/grant *flows* remain a
> useful conceptual reference. Authoritative specs: [plan/](./plan/) + the phase dirs.

Status: design synthesis. Reconciles the authoritative **PrivMX User Groups** spec
([user-groups.pdf](./user-groups.pdf)) with the current bridge implementation and the revocation
analysis. This is the **target** we recommend converging on.

Companion docs: [groupApi-architecture.md](./groupApi-architecture.md) (what's implemented today),
[groupMembershipSignature.md](./groupMembershipSignature.md) (signed-log contract),
[groupApi-endpoint-guide.md](./groupApi-endpoint-guide.md) (endpoint side).

---

## 1. Glossary

**Bridge** — the (untrusted-for-plaintext) server that stores encrypted blobs, enforces access
control and signature/coverage checks, runs queries, and distributes key entries. Never sees plaintext
keys or content.

**Context** — a tenant boundary on a Bridge. All groups, users, and containers live inside one Context.

**Solution** — an application/customer grouping of Contexts (access scoping above the Context).

**User** — a participant identified by a `userId` + ECC public key within a Context. Holds a **user key**
(their ECC keypair); authenticates with it; signs everything they author.

**External user** — a user that authenticates against a *different* Bridge/Context (cross-organization).

**Public user** — a participant identified only by an ECC public key, belonging to no Bridge (e.g. a
form/inbox sender).

**Group** — a named set of members within a Context, with its own (versioned) **group keypair**. Used to
address messages to many users at once and to grant access to containers as a single entity.

**External group** — a group whose membership is owned by another organization.

**Member** — a user belonging to a group, carrying a **UserRole**.

**Grantee** — anything granted access to a container: a group (and, in the unified model, a single user
is a one-element group). Carries a **GroupRole** on that container.

**Container** — the base resource that holds items (a thread holds messages, a store holds files, a kvdb
holds entries, …). Content is encrypted with the container's **encryption key**.

**Item** — an element inside a container (message, file, entry).

**Resource** — umbrella term for containers and items.

**Message / data unit** — one authored, signed, encrypted unit placed in a container by its author.

**User key** — a user's ECC keypair (their context key). Root of the key hierarchy.

**Group key (GK)** — a group's ECC keypair, **versioned** (`GK_v` for epoch `v`). The private half is
distributed to members; the public half (`groupPubKey`) is the group's identity for receiving encrypted
keys. New epochs are created on membership removal or key compromise; the group keeps a **history** of
versions.

**Encryption key (CK)** — a per-container *symmetric* key that encrypts the container's content. Rotated
(to `CK'`) only when content forward secrecy is required; versioned by `keyId`.

**Group key entry** — `GK_v` (group private key, version `v`) encrypted to a member's user public key.
A signed stamp binds *author → member → group → version*. **Stored with the group.**

**Encryption key entry** — `CK` encrypted to a group's public key (`groupPubKey`). A signed stamp binds
*author → group → resource → keyId*. **Stored with the container.**

**Stamp** — the signed metadata of a key entry (author, destination, placement, timestamp, keyId, random
uuid). Lets any client verify *who* distributed *which* key *to whom* for *what*.

**Signed membership log** — the group's append-only, `prevSignature`-chained history of
create/update/modifyMembers operations, each signed by its author. Lets clients verify the member set was
only ever changed by authorized managers (see [groupMembershipSignature.md](./groupMembershipSignature.md)).

**UserRole `{ USER, MANAGER }`** — a member's role **within a group**. `MANAGER` may administer the group
(membership, keys, metadata); `USER` is a plain member.

**GroupRole `{ READ, WRITE, PUSH }`** — a group's role **on a container it's granted to**: `READ` =
decrypt/read + list; `WRITE` = READ + create/update items; `PUSH` = append/submit-only (encrypt-to-and-send
without read, e.g. inbox/dropbox).

**Policy** — per-context/per-container rules mapping roles → allowed operations (create/read/update/delete/…).

**ACL** — per-user function-level allow/deny rules checked by the Bridge.

**Server-enforced revocation** — the Bridge immediately stops serving a removed user any content or key
entries. The *primary*, immediate revocation mechanism.

**Lazy re-encryption** — deferring container key rotation until the next write, so removal stays cheap.

**Forward secrecy** — guaranteeing a removed member (who cached a key) can't read *future* content; requires
rotating the affected container's encryption key.

**Key version / epoch** — monotonic counter on the group key; entries are tagged with the version they were
wrapped under so members retain access to versions they were entitled to.

---

## 2. Suggested architecture (the decisions)

1. **Three-key hierarchy** (per spec §3.1): user key → group key (versioned) → encryption key. Decryption
   chains user-priv → group-priv(version) → CK → content.
2. **Key entries stay where the spec puts them** (§3.6): **encryption key entries on the container**,
   **group key entries on the group**. We do **not** relocate container keys into a group keyring.
3. **Two role axes** (per spec Appendix A): `UserRole {USER,MANAGER}` for *membership*; `GroupRole
   {READ,WRITE,PUSH}` for *container grants*. (This replaces today's grant role `"user"|"manager"`.)
4. **Versioned group keys**: a group holds a key history; membership removal / compromise mints a new
   version; entries are version-tagged.
5. **Revocation is server-first + lazy** (§3.8.2, §3.11): removal is group-local and O(1) at the Bridge;
   cryptographic forward secrecy is achieved by **optional, lazy, per-container** key rotation. Removing a
   member never forces a synchronous fan-out over all of the group's containers.
6. **Integrity by signatures**: keep the chained signed membership log for the member set; additionally
   (per spec §3.17) every key entry carries a signed stamp so each key distribution is independently
   attributable.
7. **Grantee = group** (per spec §3.19, the unification target): a single user is a one-element group whose
   pubkey is the user's pubkey, so a container is granted to a list of groups (some degenerate). This is the
   clean path for adding more roles later; the current code still models direct users separately (see §10).

---

## 3. Keys & key entries

```
user key (asymmetric, per user)
   │  decrypts
   ▼
group key entry  =  Enc_{userPub}( GK_priv_v )        ── stored WITH THE GROUP, version-tagged
   │  yields GK_priv_v
   ▼
encryption key entry  =  Enc_{groupPub_v}( CK )        ── stored WITH THE CONTAINER, keyId-tagged
   │  yields CK (symmetric)
   ▼
container content  =  Enc_{CK}( messages / files )
```

- A **member** of group G holds `GK_priv` for the versions they were entitled to (one group key entry per
  version, each wrapped to their user pubkey).
- A **container** granted to G stores one encryption key entry per (group, CK keyId): `Enc_{groupPub}(CK)`.
- A **direct user** of a container (non-group) stores a per-user encryption key entry `Enc_{userPub}(CK)`
  (in the unified model this is just a one-element group).

The Bridge stores all of these as opaque blobs and **filters** them (§3.2): a user may download only the
group key entries addressed to them, and only the encryption key entries of groups they belong to.

---

## 4. Roles (two axes — don't conflate them)

| Axis | Enum | Where | Meaning |
|---|---|---|---|
| Membership | `UserRole {USER, MANAGER}` | user **in** a group | MANAGER administers the group (members, keys, metadata); USER is a plain member |
| Grant | `GroupRole {READ, WRITE, PUSH}` | group **on** a container | READ = read+list; WRITE = read + create/update items; PUSH = append/submit-only (no read) |

Resolution: a caller's effective rights on a container = the **union** over (direct grants) ∪ (grants of
groups they belong to). Group → container rights come from the *GroupRole* of the grant; whether the caller
counts as a "manager of the container" for destructive ops is decided by container policy against that
GroupRole (e.g. policy may require `WRITE`). Adding a role later = widen `GroupRole` and extend the policy
map — no schema churn.

---

## 5. Data model (what lives where)

**Group**
```
group {
  groupId, contextId
  groupPubKey            // current version's public key (the group identity)
  keyVersion             // monotonic epoch
  keyHistory[]           // past public keys (so old entries stay verifiable/readable)
  members: [{ userId, role: UserRole }]
  data                   // opaque (name/description, etc.)
  policy
  membershipLog[]        // signed, prevSignature-chained (create/update/modifyMembers)
}
groupKeyEntries[]  =  { user, keyVersion, Enc_{userPub}(GK_priv_version), stamp, signature }
```

**Container** (thread/store/inbox/kvdb/stream)
```
container {
  id, contextId, type
  users: UserId[]; managers: UserId[]          // direct users (legacy axis)
  groups: [{ groupId, role: GroupRole }]       // group grants  (role-tagged)
  keyId                                        // current CK version
  content / items
  history[]
  policy
}
encryptionKeyEntries[]  =  { group, keyId, Enc_{groupPub}(CK), stamp, signature }   // per grantee group
userKeyEntries[]        =  { user, keyId, Enc_{userPub}(CK), … }                    // per direct user
```

---

## 6. Trust & revocation model

Two separable guarantees:

- **Server-enforced access (immediate, primary).** The Bridge resolves a caller's current group
  memberships on every request and refuses content + key entries to anyone not currently entitled. This is
  the first line of defense (§3.11) and requires **no container changes** on membership churn.
- **Cryptographic forward secrecy (optional, lazy).** To stop a *cached-key* reader from decrypting future
  content, the affected container's `CK` must rotate. This is done **per container, on next write**, never as
  a synchronous fan-out at removal time. An eager variant exists (re-key everything now) and may use a
  server-side resource search to enumerate affected containers — but it's the costly path and is optional.

Group keys are **versioned** so the two guarantees compose: removal mints `GK_{v+1}` for the remaining
members; old content stays readable by retained `GK_v`; new/ re-keyed content uses `GK_{v+1}`, which the
removed user never receives.

---

## 7. Flows (detailed)

Legend for "Changes": **G** = group doc, **GKE** = group key entries, **C** = container doc, **EKE** =
encryption key entries.

### 7.1 Create group
*Who:* a context user (becomes owner/MANAGER).
1. Generate group keypair `GK_1`; publish `groupPubKey` in the group's public data.
2. Encrypt `GK_priv_1` to each initial member's user pubkey → group key entries (version 1).
3. Sign the genesis membership-log entry (`prevSignature = null`).
4. Bridge stores the group + entries (after verifying signature + manager authority).

**Changes:** G created (`keyVersion=1`); GKE created for each member; membership log = [genesis].
**Cost:** O(members).

### 7.2 Add member to group
*Who:* a MANAGER of the group.
1. Take the current group private key (and, optionally, past versions if the new member should read history).
2. Encrypt it to the new member's user pubkey → new group key entry(ies); sign the stamp(s).
3. Append a signed `modifyMembers` log entry.
4. Bridge stores them (verifies the new member exists in the Context + signature + authority).

**Changes:** G.members += member; GKE += entries for the new member; membership log += entry.
**Containers:** **untouched** — the new member can now read every container the group is granted to, because
those containers' encryption key entries are wrapped to the group key the member just received.
**Cost:** O(1) (per added member). No container writes.

### 7.3 Remove member from group  ← the important one
*Who:* a MANAGER of the group.
1. **Mint a new group key version** `GK_{v+1}` (new keypair).
2. Encrypt `GK_priv_{v+1}` to **each remaining** member → new group key entries (version `v+1`).
3. Append a signed `modifyMembers` log entry (removed user dropped from the member set).
4. The Bridge updates the group, **immediately stops serving the removed user** any of the group's content
   or key entries, and (per §3.2) will not hand them version `v+1`.
5. **(Optional, lazy) forward secrecy:** the group's containers are *not* re-keyed now. Each container
   rotates its `CK` on its next write (see §7.8), wrapping the new `CK'` to the group's *current* pubkey
   `groupPub_{v+1}` (and to every other grantee — see §7.8).

**Changes:** G.keyVersion → v+1, G.members -= user, G.keyHistory += old pubkey; GKE replaced for remaining
members (version v+1); membership log += entry. **Containers & EKE: untouched at removal time.**
**What the removed user can/can't do:**
- Immediately: blocked by the Bridge from all the group's containers (no content, no new keys). ✓
- Cached `GK_priv_v` lets them decrypt *old* encryption key entries they already downloaded → they can read
  *old* content of containers they hadn't yet been re-keyed — until each is lazily re-keyed. New content
  (under `CK'`, wrapped to `groupPub_{v+1}`) is unreadable to them. ✓
**Cost:** O(remaining members), one group write. **No container fan-out.**

### 7.4 Rotate group key (`generateNewGroupKey`)
*Who:* a MANAGER. *When (spec §3.8.4):* a member's user key changed/compromised, or the group key
compromised — independent of membership change.
1. Mint `GK_{v+1}`; encrypt to all current members; sign; update.
Same shape as removal step 1–4 minus the membership delta. Forward secrecy of containers is again lazy.

**Changes:** G.keyVersion → v+1, keyHistory += old; GKE replaced for all members.

### 7.5 Create container granting groups
*Who:* a context user with create rights.
1. Generate the container content key `CK` (keyId).
2. Encrypt content with `CK`.
3. For each grantee group `{groupId, role}`: encrypt `CK` to that group's current `groupPub` → encryption
   key entry; sign the stamp. For each direct user: `Enc_{userPub}(CK)`.
4. Bridge verifies coverage (every grantee has an EKE for `keyId`; grantee groups exist in the Context) +
   signatures, then stores.

**Changes:** C created with `groups: [{groupId, role}]`; EKE created per grantee group; user key entries per
direct user.
**Cost:** O(#grantees of this container). The content is encrypted **once**; only the small `CK` is wrapped
per grantee.

### 7.6 Grant an existing group access to a container
*Who:* a manager/WRITE-grantee of the container.
1. Add `{groupId, role}` to `C.groups`.
2. Encrypt the container's current `CK` to the group's `groupPub` → new EKE; sign.
3. Bridge stores (verifies the granter's authority + the group exists + signature).

**Changes:** C.groups += grant; EKE += one entry. **Other grantees untouched.** O(1).

### 7.7 Revoke a group's access to a container
*Who:* a manager/WRITE-grantee of the container.
1. Remove `{groupId, …}` from `C.groups` and drop that group's EKE.
2. The Bridge immediately stops serving that group's members this container.
3. **(Optional, lazy)** rotate `CK` (§7.8) to forward-secure against members who cached the old `CK`.

**Changes:** C.groups -= grant; EKE -= that group's entry. O(1) + optional lazy re-key.

### 7.8 Rotate a container's encryption key (forward secrecy / lazy re-key)
*Who:* the next writer to the container (or an eager re-key job).
1. Generate `CK'` (new keyId). New content is encrypted under `CK'`. (Old content stays under old `CK` —
   the past is not re-encrypted.)
2. Read `C`'s **current grantee set** — local to `C`: `C.groups` + direct users.
3. For each grantee group: `Enc_{groupPub_current}(CK')` → new EKE (this automatically uses each group's
   latest key version, excluding anyone removed from *any* of them). For each direct user: `Enc_{userPub}(CK')`.
4. Sign stamps; write `C` once.

**Changes:** C.keyId → new; EKE replaced for all grantees (1 wrap per grantee); content key advanced.
**Cost:** O(#grantees of this container) cheap key-wraps + 1 data-encryption. This is the **only** fan-out,
it's one level deep (just this container's grantees, group-keys wrapped once each), and it's lazy.

### 7.9 Read a container (decryption chain)
*Who:* any member of a grantee group (or direct user).
1. Fetch the group key entry addressed to me (for a version I hold) → `GK_priv`.
2. Fetch the container's encryption key entry for my group + `keyId` → `Enc_{groupPub}(CK)` → unwrap with
   `GK_priv` → `CK`.
3. Decrypt content with `CK`. Verify message author signatures (§3.18) and, for membership-sensitive checks,
   replay the signed membership log.

The Bridge only serves steps 1–2 if I'm currently entitled — which is what makes removal immediate.

---

## 8. Bridge responsibilities (zero-knowledge enforcement)

- **Key-entry filtering (§3.2):** serve a user only their own group key entries, and only the encryption key
  entries of groups they currently belong to. Refuse everything to removed users immediately.
- **Coverage checks:** on create/grant/re-key, verify every grantee (group/user) has an encryption key entry
  for the container's `keyId`, and that no extra grantee has one.
- **Membership-log verification:** verify each group op's signature + `prevSignature` chain (`INVALID_SIGNATURE`
  / `GROUP_VERSION_MISMATCH`).
- **Stamp verification (optional, §3.17):** verify each key entry's stamp signature binds author→to→place→keyId.
- **Access/policy/ACL:** resolve the caller's current group memberships live; map GroupRole + policy → allowed
  ops; enforce ACL.
- **Referential integrity:** refuse deleting a group still granted to any container (`GROUP_IN_USE`).
- Never sees `GK_priv`, `CK`, or plaintext content.

---

## 9. Cost summary

| Operation | Group writes | Container writes | Crypto (key-wraps) | Forward secrecy |
|---|---|---|---|---|
| Add member | 1 | 0 | O(1) per added | n/a |
| **Remove member** | 1 | **0** | O(remaining members) | server-enforced now; crypto on lazy re-key |
| Rotate group key | 1 | 0 | O(members) | as above |
| Grant group → container | 0 | 1 (+EKE) | 1 | n/a |
| Revoke group ← container | 0 | 1 | 0 | server-enforced; crypto on lazy re-key |
| Container re-key (lazy) | 0 | 1 | O(#grantees of that container) | ✅ for new content |
| Read | 0 | 0 | 2 unwraps | — |

The content of a container is encrypted **once** under its `CK`; per-grantee cost is only a tiny `CK`
key-wrap. A group is **one** grantee regardless of its member count.

---

## 10. Alignment with the current implementation (gaps & migration)

What today's code already matches: three-key model with `groupPubKey`; encryption key entries on the
container (`groupKeys`); signed, chained membership log; ACL + container policy; server-enforced access via
live membership resolution; `groupModifyMembers` (= spec `updateUsersInGroup`); `GROUP_IN_USE` on delete.

Gaps to close to reach this target:
1. **Grant role enum:** `GroupGrant.role` is currently `"user"|"manager"` → change to **`GroupRole
   {READ,WRITE,PUSH}`**; map those to access levels in `BasePolicy`/`withGroupMembership` instead of
   user/manager.
2. **Group key versions:** add a `keyVersion`/`keyHistory` to the group and tag group key entries +
   encryption key entries with the version; readers select the version they hold.
3. **`generateNewGroupKey` + `updateMyIdentity`:** add as first-class operations (compromise/rotation,
   member-key change) — distinct from membership changes.
4. **Lazy re-encryption contract:** define the "re-key on next write" convention (stale-version detection)
   and, optionally, a server-side resource-search to support eager re-keying.
5. **Per-key-entry stamps (§3.17):** optionally adopt signed stamps on each group/encryption key entry in
   addition to the membership log.
6. **Unify grantees as groups (§3.19):** longer-term, model a direct user as a one-element group so a
   container's grantees are a single uniform list (collapses `users`/`managers` + `groups` and makes future
   roles uniform). Keep the current split until then.
7. **Full version:** external users, public users, external groups, and cross-bridge identities
   (`BridgeIdentity`) — the spec's "full version" roadmap.

Decisive takeaways from the spec:
- **Keep `groupKeys` on the container; do not build a group keyring (Option B).**
- **Removal does not update all containers** — server refusal is primary; container re-keying is optional &
  lazy, enabled by group key versions.
- **Adopt `GroupRole {READ,WRITE,PUSH}`** as the grant-role taxonomy (and the basis for future roles).

---

## 11. Open questions / roadmap

- **History for newly-added members (§3.12):** do new members get past group key versions (read history) or
  only current-forward? Pick a policy; key-versioning supports either.
- **PUSH semantics** across container types (inbox-style submit-only) — define per container.
- **Eager re-encryption** tooling: the server-side resource-search to enumerate a group's containers + their
  grantees, if immediate forward secrecy across the graph is ever required.
- **Nested/super-groups:** to collapse the per-grantee wrap count when the same coalition recurs (still out
  of scope; revisit if it becomes a real cost).
- **External/cross-bridge** trust and PKI for `BridgeIdentity`.
