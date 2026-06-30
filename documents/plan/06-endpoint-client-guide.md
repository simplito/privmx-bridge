# 06 — Endpoint (client library) guide

> Status legend in [README.md](./README.md). This is the **privmx-endpoint (C++)** design — a separate repo,
> 🔵 throughout. It mirrors the bridge contract in [02-bridge-api-contract.md](./02-bridge-api-contract.md).
>
> **⚠️ DESIGN UPDATE — supersedes §4/§5 below.** The bridge no longer has a `GroupMembershipSignature` /
> `PMX_GROUP_SIG` format and does **not** verify anything. The membership proof (author signature + member set
> + chain link) must be committed **inside the group `data` blob** using the endpoint's existing
> **`DataIntegrityObject` (DIO)** + `EncKeyEncryptorV2` + `UserVerifier` — *not* a bespoke canonical
> serializer. §4 ("build the canonical payload …") and §5 are kept for the conceptual replay algorithm, but
> read them as **"DIO inside `data`"**, per [10-endpoint-security-model-and-alignment.md](./10-endpoint-security-model-and-alignment.md)
> §3b/§4. The two genuinely new things the endpoint adds on top of DIO are the **chain link (G1)** and
> **manager-authorization-at-the-time (G2)**.

The endpoint is the **security boundary**: the bridge is untrusted, so the client generates all keys, commits
the membership proof in the DIO it stores in `data`, and **verifies the chain** on every read.

---

## 1. Public surface (`group::GroupApi`)

Mirror the bridge RPCs (and the C++ draft in [../groupApi.md](../groupApi.md)):

| Endpoint method | Bridge RPC | Notes |
|---|---|---|
| `createGroup(contextId, users, managers, publicMeta, privateMeta)` | `context.groupCreate` | generates `GK`; returns `groupId` |
| `updateGroup(groupId, …, version, force)` | `context.groupUpdate` | full replace; integrity committed in `data` (no `prevSignature` field). **This is the membership-change mechanism** (add = old ∪ new, remove = old − removed) |
| ~~`modifyGroupMembers(...)`~~ | ~~`context.groupModifyMembers`~~ | 🟡 **deferred** — delta path, see [08-future-plans.md](./08-future-plans.md) §1. Use `updateGroup` instead |
| `deleteGroup(groupId)` | `context.groupDelete` | `GROUP_IN_USE` if still a grantee |
| `getGroup(groupId)` | `context.groupGet` | returns group + signed history — **verify the chain** |
| `listGroups(contextId, pagingQuery)` | `context.groupList` | |

`publicMeta`/`privateMeta` are encrypted into `data` exactly like a thread's data, keyed by the group's
symmetric data key (`keyId`). Reuse the existing endpoint container-data machinery for that.

Grantee operations live on the existing container APIs (thread/store/inbox/kvdb/stream `create`/`update`),
extended to accept `groups` + `groupKeys` — see §7.

---

## 2. Client state

All state is **rebuildable from the bridge** — no mandatory persistence, no commit replay (this is the
"lite" win vs MLS).

- **Per group:** `groupId`, current `groupPubKey`, 🟡 current `epoch`, and the set `{ epoch → GK.priv }` for
  the epochs this member is entitled to (each decrypted from a group key entry addressed to the member).
  Today (pre-epoch) this is a single current `GK.priv`.
- **Per container:** `keyId` (current `CK` version) and the unwrapped `CK` per `keyId` (cache). The
  encryption key entry it used records `(group, keyId)` 🟡(+`groupEpoch`).

If offline through several changes, the endpoint simply re-fetches the key entries it's entitled to and
rebuilds. **No "bricking", no resync handshake.**

---

## 3. Crypto primitives (already in the endpoint)

- Asymmetric key-wrap (ECIES/HPKE-style) of a key to a public key — used today for container keys.
- Symmetric AEAD for content.
- ECDSA signatures (`signToCompactSignature` / `verifySignature2`) for stamps + membership-log entries.

No new primitives. Group support is new **bookkeeping** + the signing/verification discipline below.

---

## 4. Committing the membership proof (DIO inside `data`)

> **REWRITTEN — the bespoke `PMX_GROUP_SIG` byte format and `GroupMembershipSignature.digest()` are GONE**
> (doc 10 §3b). Do **not** build a length-prefixed canonical buffer signed against bridge fields. Instead
> commit the membership proof inside the group `data` using the existing `DataIntegrityObject` (DIO). The
> authoritative, C++-grounded spec is [../endpoint_phase_one/02-keys-and-integrity.md](../endpoint_phase_one/02-keys-and-integrity.md).

On **every** `create` / `update` (the current ops; `modifyMembers` is 🟡 deferred — doc 08):

1. Build the group `data` via `GroupDataEncryptorV5` (mirror of `ModuleDataEncryptorV5`): a DIO that commits
   `publicMeta`, `privateMeta`, the wrapped `groupPrivKey`, and the **`membership` block**
   `{ users, managers, groupPubKey, keyId, prevEntryHash }` (sorted lists; `prevEntryHash` = sha256 of the
   prior version's signed DIO blob, `null` at genesis). The DIO is signed with the acting manager's context
   private key (secp256k1 / SHA-256 / 65-byte compact — the existing primitive).
2. Submit the `data` blob in `groupCreate`/`groupUpdate`. There is **no `signature`/`prevSignature` request
   field** — the bridge stores `data` opaquely and verifies nothing.

**Shared test vectors (do this early):** fix the **DIO + `membership` block** serialization (sorted lists,
fixed field order) and assert vectors in CI on both repos so a serializer divergence fails fast. This is the
single highest correctness risk in the feature.

---

## 5. Verifying on read (the security boundary)

On `getGroup`/`listGroups`, replay the returned per-version `data` (DIO blobs) genesis→head:

1. Verify each version's **DIO signature** against its committed `creatorPubKey` (`DIOEncryptorV1.decodeAndVerify`).
2. Verify the chain link: `membership[i].prevEntryHash == sha256(data[i-1])` (genesis = `null`).
3. Verify each signer was an **authorized manager in the state prior to that version** (derive that state by
   replaying up to the previous version — do **not** use current membership).
4. Verify the DIO-committed `membership` (users/managers/groupPubKey/keyId) equals what the bridge served per
   version, and matches the head.
5. Run `UserVerifier` on every distinct signer; decrypt your group data-key entry → `data` → `GroupPriv`.

Any failure → surface as a **tamper/integrity error** (`statusCode`≠0), not a silent fallback. Full algorithm:
[../endpoint_phase_one/03-verification.md](../endpoint_phase_one/03-verification.md).

### 5.1 Avoiding full replay — incremental verification 🟡

Full genesis→head replay is O(history length) ECDSA verifications **per read** — overwhelming for long-lived,
churny groups. You can't cherry-pick the last entry (authorization is **inductive**: the signer of entry *k*
must be shown to be a manager, which depends on entries `< k`), but you can avoid re-verifying a prefix you've
already verified. Three layers, cheapest first; all are **optional caches/optimizations** — losing them falls
back to full replay, so they do **not** reintroduce MLS-style mandatory state / "bricking".

**(a) Cached verified head — the primary win (steady state → O(1) or O(Δ)).**
Persist `{ verifiedHeadHash, verifiedMembers, verifiedManagers, verifiedGroupPubKey }` per group
(`verifiedHeadHash` = sha256 of the head version's signed DIO blob).
- On `getGroup`, **compare the served head DIO hash to the cached one — O(1).** Unchanged ⇒ **zero**
  verifications; trust the cached state.
- Changed ⇒ walk back from the new head via `prevEntryHash` until you reach your cached head, then verify
  **only the new tail** (O(Δ)), checking each new signer is a manager per your already-trusted state.
- If the cached head is **not** an ancestor of the new head ⇒ the bridge forked/equivocated ⇒ reject. (Free
  equivocation detection across your own timeline.)
- This is a cache: a new device / cleared storage simply does a full replay once, then caches.

**(b) Signed checkpoints — bound the cold cost (new device / cache miss → O(since last checkpoint)).**
A manager periodically emits a `checkpoint` version (🟡 a DIO-committed `membership` attesting the prior state,
see [02-bridge-api-contract.md](./02-bridge-api-contract.md) §7.1): signed *"as of prevEntryHash H_k, authorized
members = M, managers = G, groupPubKey = P"*. A client trusting the checkpoint signer starts replay **from the
checkpoint** instead of genesis. Trade-off: this trusts one manager's attestation of the prefix. Mitigate with
**threshold / multi-manager co-signed** checkpoints and **trust-but-verify** (occasionally do a full audit so a
forged checkpoint is eventually caught). Checkpoints also enable history pruning
([03-data-model-and-consequences.md](./03-data-model-and-consequences.md) §7).

**(c) Transparency-log Merkle proofs — prefix-tamper assurance without trusting a checkpoint signer (heavier).**
Model the log as an append-only Merkle tree (CT-style). Cache a verified tree head; the bridge returns an
**O(log n) consistency proof** that the new head append-only-extends it. Verify signatures only on the new
leaves. Merkle consistency proves *"same bytes as before"* (integrity); signature replay proves *"those bytes
were authorized."* They compose: full replay **once**, then forever O(log n) prefix proof + O(Δ) tail
signatures. Costs the bridge a Merkle tree.

**Crypto-level batching is a dead end here.** The log uses secp256k1 **ECDSA** (`ECUtils` compact sigs), which
has no efficient batch verification. Only switching the log's signatures to **Schnorr (BIP340)** or
**Ed25519** enables batch verify — a ~2× constant factor, still O(n). Not worth a scheme migration; the
structural wins above are where the reduction is.

**Recommendation:** implement (a) first (pure client bookkeeping, safe fallback). Add (b) when groups become
long-lived/churny. Reserve (c) for when prefix-tamper assurance without a trusted checkpoint signer is
required.

---

## 6. Group-as-grantee + reconciliation (re-keying)

### Granting / reading
- **Grant:** when adding a group to a container, `getGroup` for its current `groupPubKey`, wrap the container
  `CK` to it → `GroupKeyEntrySet {group, keyId, data}`, submit in `groupKeys` alongside `groups:[{groupId,
  role}]`.
- **Read:** resolve *my group key entry → `GK.priv` → encryption key entry → `CK` → content*.

### Reconciliation — the endpoint owns re-keying
Because the bridge cannot re-encrypt container keys when a group changes, the endpoint must re-distribute
affected container keys. Two modes:

- **Lazy (recommended default, 🟡🔵):** on the next **write** to a container, detect staleness (the
  container's stored `groupEpoch` for a grantee `<` that group's current epoch) and re-key as part of that
  write (algorithm in [05-flows.md](./05-flows.md) §5c). Costs nothing until someone writes; gives forward
  secrecy from the rotation point.
- **Eager (optional):** on a `groupUpdated` event, enumerate the containers the group grants into and re-key
  them proactively. Needs a "containers a group grants into" query (🟡 bridge helper). Use when you want
  removed members locked out of *future* content even on idle containers immediately.

### Re-key write content
`CK' = freshSymKey()`, new `keyId'`; wrap `CK'` to each grantee group's **current** `groupPubKey` and to each
direct user; emit a **key-confirmation tag** `MAC_{CK'}("confirm"||keyId')` so recipients verify their
unwrapped `CK'` before adopting (anti garbage-key, 🟡); submit one container update.

---

## 7. Container API extensions (thread/store/inbox/kvdb/stream)

Extend each container's `create`/`update`:
- add `groups: [{groupId, role}]` and `groupKeys: [{group, keyId, data}]`;
- when adding a group, wrap the container key to that group's `groupPubKey`;
- on decrypt, resolve via the group privkey as in §6.

The bridge enforces **set-equality coverage** — you must include exactly one key entry per current grantee
group for the container's `keyId` (no missing, no extra) or it rejects with `INVALID_PARAMS`.

---

## 8. Concurrency handling 🟡

- Tag rotations with `expectedVersion` (the group epoch / container generation).
- On `ROTATED_ALREADY`: verify the winner's signature, decrypt the included envelope addressed to you, adopt
  the new epoch key, **retry** the original op — no extra round trip, no re-generation. ([05-flows.md](./05-flows.md) §7.)

---

## 9. What the endpoint does NOT implement (the "lite" savings)

- ❌ Ratchet tree / TreeKEM path updates.
- ❌ Commit/Proposal/Welcome/GroupInfo processing or an epoch-ordered state machine.
- ❌ KeyPackage publishing/consumption/expiry.
- ❌ Mandatory statefulness / resync — state is rebuildable from bridge key entries.
- ❌ Post-compromise security machinery / per-message ratchet.

(If PCS or O(log n) scale ever becomes a hard requirement, see the forward-compatibility analysis in
[../group-mls-lite-plan.md](../group-mls-lite-plan.md) §8/§9 — the container/grant/data layer is designed to
survive an MLS swap without breaking changes; the group key-agreement module is the contained piece that
would be replaced.)

---

## 10. Error codes the endpoint must handle

`GROUP_DOES_NOT_EXIST`, `GROUP_IN_USE`, `GROUP_VERSION_MISMATCH`, `INVALID_SIGNATURE`,
`DUPLICATE_RESOURCE_ID`, `ACCESS_DENIED`, `INVALID_PARAMS`, `INVALID_KEY_ID`, `USER_DOESNT_EXIST`, and
🟡 `ROTATED_ALREADY`.

Map them to library exceptions; for `GROUP_VERSION_MISMATCH` on a write, re-`getGroup`, rebuild the payload
against the new head, and retry. For chain-verification failures on read, raise a tamper error — never
silently trust the bridge's served state.

---

## 11. Capability / version negotiation (works with doc 07)

- A **new endpoint** must treat a container's `groups`/`groupKeys` as possibly **absent** (old container or
  old peer that never set them) → behave exactly as today (direct-user keys only).
- A **new endpoint** reading a container it can only access via a group it doesn't have a key for → surface
  "no access" rather than crashing.
- An endpoint should advertise group support via its protocol/version handshake so apps can choose to grant
  to groups only when all relevant peers are new (see [07-backward-compatibility-and-migration.md](./07-backward-compatibility-and-migration.md) §4/§6).
