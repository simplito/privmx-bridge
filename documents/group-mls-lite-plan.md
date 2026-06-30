# Group "MLS-lite" plan — versioned keys, lazy revocation (no MLS)

> **ℹ️ This is the PHASE-2 design rationale.** The actionable, current Phase-2 build specs are
> [bridge_phase_two/](./bridge_phase_two/) + [endpoint_phase_two/](./endpoint_phase_two/) — prefer those for
> implementation; keep this doc for the *why*. Two later decisions adjust wording below:
> - **GroupMembershipSignature dropped** (plan/10 §3b): the bridge **verifies nothing** and there is no
>   `prevSignature`/signed-log bridge field. Where this doc says the bridge "enforces signatures" (§2) or to
>   "sign the membership-log entry / chained by `prevSignature`" (§3.3/§3.6) → the proof is committed in the
>   endpoint **DIO inside `data`** and verified client-side; `keyVersion`/epoch is committed there too.
>   References to `groupMembershipSignature.md` are **obsolete**.
> - **Delta membership DEFERRED** (plan/08): `addMembers`/`removeMembers`/`modifyMembers` as *delta* ops are
>   Phase-2+/future; in Phase 1 membership change is **full-replace `groupUpdate`**. The epoch-rotation
>   mechanics here (fresh-random epoch on removal, lazy re-key) are the Phase-2 substance and remain valid.
> §8/§9 (PCS, MLS forward-compat) are unaffected.

Status: implementation plan (Phase-2 design rationale). Chosen over full MLS (RFC 9420/9750): we keep
PrivMX's asymmetric group-grant model and get **forward secrecy** via group key **epochs** + **lazy
re-encryption**, without TreeKEM, a Delivery-Service handshake log, KeyPackages, stateful epoch sync, or PCS.

See [group-architecture-and-flows.md](./group-architecture-and-flows.md) for the full model/flows and
[user-groups.pdf](./user-groups.pdf) §3.8/§3.11/§3.12 (this is the spec's own "optional re-encryption +
key versions" path).

---

## 1. What MLS-lite is (and isn't)

| | MLS-lite (this plan) | Full MLS |
|---|---|---|
| Group key | versioned **asymmetric keypair**, fresh random per epoch | symmetric epoch secret via TreeKEM |
| Membership-change cost | O(members) re-wrap (one group write) | O(log n) Commit |
| Forward secrecy | ✅ new content unreadable to removed members | ✅ + per-message ratchet |
| Post-compromise security | ❌ | ✅ (self-heal) |
| Group-as-grantee (wrap to group pubkey) | ✅ kept | ✗ (needs hybrid) |
| Client state | stateless-ish: rebuildable from key entries on the Bridge | stateful: ordered commits, ratchet tree, resync |
| New server subsystems | none (reuse key-entry store) | KeyPackage directory + ordered handshake log |

**Core idea:** each group has a monotonic **epoch**. A membership removal (or key compromise) mints a new
**independent random** group keypair for the next epoch and re-wraps it to the *remaining* members. Members
keep the epoch private keys they were entitled to. Container content keys are wrapped to the group's
**current** epoch pubkey; revocation is **immediate at the Bridge**, and cryptographic forward secrecy is
achieved by **lazily re-keying each container on its next write**.

Epoch keys are **independent random** keypairs (NOT a forward-derivable hash chain) — that's deliberate: a
removed member holding epoch `v` must not be able to derive epoch `v+1`.

---

## 2. Bridge side (this repo) — concise

1. **Group gains epochs:** `keyVersion` (monotonic) + `keyHistory[]` (past public keys). Group key entries
   are tagged with the epoch they carry.
2. **Encryption key entries tagged with group epoch:** each container's per-group `groupKeys` entry records
   the `groupEpoch` its `CK` was wrapped under (so clients select the right one and detect staleness).
3. **`generateNewGroupKey(groupId, ...)`** as a first-class op (epoch bump without a membership delta) — for
   §3.8.4 compromise cases. `groupModifyMembers` (removal) also bumps the epoch.
4. **Keep server-enforced revocation** (already implemented via live `getCallerGroupIds`): a removed user is
   refused content + key entries immediately; the Bridge serves current-epoch entries only to current members.
5. **Keep `groupKeys` on the container** (no group keyring / Option B).
6. **Grant role → `GroupRole {READ, WRITE, PUSH}`** (replaces `ContainerRole "user"|"manager"`).
7. **Optimistic concurrency on `keyVersion`** (atomic CAS) with a `ROTATED_ALREADY` response that carries the
   winner's signed envelope (§4); **set-equality coverage check** (anti-ghosting), **manager-only rotation +
   rate-limiting** (anti-spam) (§5).
8. **Optional:** a query to enumerate containers a group grants into (generalized `isGroupReferenced`) to
   support *eager* re-keying; lazy mode needs nothing extra.

The Bridge never re-keys anything itself and never sees private keys — it stores epoch-tagged blobs and
enforces membership/coverage/signatures (including set-equality coverage and the `keyVersion` CAS).

---

## 3. Endpoint side (privmx-endpoint, C++) — the focus

The endpoint already wraps symmetric container keys to user public keys and signs everything (that's how
thread/store keys work today). **MLS-lite reuses exactly those primitives.** The new work is: group keypair
generation, **epoch bookkeeping**, epoch-tagged encryption-key-entry selection, and a **lazy re-key step on
writes**.

### 3.1 State the endpoint manages (all rebuildable from the Bridge)
- **Per group:** `groupId`, current `epoch`, current `groupPubKey`, and the set `{ epoch → groupPrivKey }`
  for the epochs this member is entitled to (each decrypted from a group key entry addressed to them).
- **Per container:** `keyId` (current `CK` version), and the unwrapped `CK` per `keyId` (cache). The
  encryption key entry it used records `(groupId, groupEpoch, keyId)`.

Nothing here is order-dependent: if the endpoint is offline through several epochs, it simply re-fetches the
key entries it's entitled to and rebuilds. **No commit replay, no resync, no "bricking."** This is the whole
"lite" win for the client.

### 3.2 Crypto primitives (already in the endpoint)
- Asymmetric key-wrap (ECIES/HPKE-style) of a key to a public key — used today for container keys.
- Symmetric AEAD for content.
- ECDSA signatures for stamps + membership-log entries.
No new primitives; MLS-lite is new *bookkeeping* on top.

### 3.3 Operations the endpoint implements

**createGroup(contextId, members[, role], meta):**
1. Generate group keypair → `(GKpub₁, GKpriv₁)`, epoch = 1.
2. For each member: wrap `GKpriv₁` to their user pubkey → **group key entry** `{user, epoch:1, blob, stamp}`,
   sign the stamp.
3. Sign the genesis membership-log entry (`prevSignature = null`).
4. Submit group (`groupPubKey=GKpub₁`, `keyVersion=1`, members) + entries + log.

**addMembers(groupId, newMembers):**  *(no epoch bump, no container changes)*
1. Wrap the **current** `GKpriv` (and, per history policy §3.5, optionally past epochs) to each new member →
   group key entries (epoch-tagged); sign.
2. Sign a `modifyMembers` log entry. Submit.
- New members can immediately read every container the group is granted to (those `CK`s are wrapped to the
  group pubkey they now hold). Containers untouched.

**removeMembers(groupId, removed) / generateNewGroupKey(groupId):**  *(epoch bump)*
1. Generate a **fresh random** keypair → `(GKpub_{v+1}, GKpriv_{v+1})`, epoch = v+1.
2. Wrap `GKpriv_{v+1}` to each **remaining** member → group key entries (epoch v+1); sign.
3. Sign the `modifyMembers`/rekey log entry; set group `groupPubKey=GKpub_{v+1}`, push old pub to history.
4. Submit. The Bridge immediately stops serving removed members.
5. **Do not** re-key containers here — that's lazy (3.3 write path).

**createContainer / grantGroup:**
1. Generate (or reuse) the container content key `CK` (keyId `k`); encrypt content with `CK`.
2. For each grantee group `g`: wrap `CK` to `g`'s **current** `groupPubKey` → **encryption key entry**
   `{group:g, groupEpoch:g.epoch, keyId:k, blob, stamp}`; sign. For each direct user: wrap to their pubkey.
3. Submit container (`groups:[{groupId, role}]`) + entries.

**read(container):**
1. Pick an encryption key entry for a group `g` I belong to.
2. Read its `groupEpoch e`; take `GKpriv_e` from my per-group key set (I hold it iff I was a member at `e`).
3. Unwrap → `CK`; decrypt content; verify author signatures (+ optionally replay the membership log).

### 3.4 The new endpoint logic: lazy re-key on write (forward secrecy)

This is the only genuinely new algorithm. On a write that requires forward secrecy:

```
onWrite(container):
  grantees = container.groups (+ direct users)         # local to this container
  stale = any g in grantees where
            container.encEntry(g).groupEpoch < currentEpochOf(g)   # group churned since last wrap
  if stale (or policy = always-rotate-on-write):
     CK' = freshSymKey(); keyId' = new
     for g in grantees: encEntry'(g) = wrap(CK', currentGroupPubKeyOf(g)); sign stamp
     for u in directUsers: userEntry'(u) = wrap(CK', u.pubKey)
     container.keyId = keyId'
     newContent = AEAD(CK', ...)
     confTag = MAC_{CK'}("confirm" || keyId')             # key-confirmation tag (§5, anti garbage-key)
     submit(container, keyId', confTag, [encEntry'...], [userEntry'...])   # one container write
  else:
     reuse current CK
```

Key points the endpoint owns:
- **Staleness detection** = compare the stored `groupEpoch` on the container's entry for `g` vs `g`'s current
  epoch (fetched from the group resource). A removal bumped `g`'s epoch ⇒ the entry is stale ⇒ re-key.
- **Same hardening as group rotation (§4–§5):** the container re-key write is coverage-checked for
  set-equality of grantees (anti-ghosting), carries a key-confirmation tag (recipients verify their unwrapped
  `CK'` before adopting), and — if the container uses a `keyId`/generation CAS — a concurrent re-key resolves
  via `ROTATED_ALREADY` + the winner's entry, same as group rotation.
- **Re-key wraps to each grantee group's *current* epoch pubkey** — so one re-key simultaneously enforces the
  latest membership of *all* grantee groups (anyone removed from any of them is excluded for free).
- This is the per-container, one-level grantee fan-out we accepted as irreducible: `CK'` is wrapped once per
  grantee (a group = one wrap regardless of its size); content is encrypted once.
- **Old content is not re-encrypted** (you can't un-share the past); only new content uses `CK'`.

### 3.5 History policy for new members
On `addMembers`, the endpoint chooses what the new member can read:
- **current-forward only:** wrap just the current epoch → new member reads new content only.
- **with history:** wrap current + selected past epoch keys → new member can read older content too.
The Bridge stores whatever entries are provided (filtered by membership); the choice is an endpoint/app
policy. (Spec §3.12 notes "everyone has equal access to encryption keys" simplifies reasoning.)

### 3.6 Signing (unchanged in spirit)
- Membership-log entries: `create`/`modifyMembers`/`rekey`, chained by `prevSignature`
  (see [groupMembershipSignature.md](./groupMembershipSignature.md)); the new `rekey`/epoch bump binds the new
  `groupPubKey` + epoch.
- Optional per-key-entry **stamps** (spec §3.17): each group/encryption key entry signed with
  author→to→place→epoch/keyId. Recommended for attributable key distribution.

### 3.7 What the endpoint does NOT need (the "lite" savings)
- ❌ Ratchet tree / TreeKEM path updates.
- ❌ Commit/Proposal/Welcome/GroupInfo processing or **epoch-ordered** state machine.
- ❌ KeyPackage publishing/consumption/expiry/"last-resort" management.
- ❌ Mandatory statefulness / resync — state is rebuildable from Bridge key entries.
- ❌ Post-compromise security machinery, per-message ratchet.

### 3.8 Endpoint effort
**Moderate.** It's an extension of the existing container-key wrapping + signing, plus: group keypair
lifecycle, the `{epoch → groupPrivKey}` map, epoch tags on encryption key entries + selection, and the
lazy-re-key-on-write path. No new crypto library, no MLS state engine.

---

## 4. Concurrency & rotation (optimistic CAS + winner-envelope retry)

Membership/rotation operations are serialized by **optimistic concurrency on the epoch integer**
(`keyVersion`), with the conflict response carrying the winner's key so losers retry cheaply. This replaces
"refetch → regenerate → reupload" and pragmatically resolves concurrent rotations without CRDTs.

- **Token:** the group's `keyVersion` (= epoch) is the optimistic-concurrency token. A rotating client tags
  its upload `expectedVersion: v`.
- **Bridge (atomic CAS):** apply the rotation with a single atomic compare-and-set
  (`update … where keyVersion = v → v+1`). Exactly one writer wins; the rest get rejected (`ROTATED_ALREADY`,
  replacing the bare `GROUP_VERSION_MISMATCH` on this path).
- **Winner's envelope in the rejection:** the rejection **includes the winning epoch's group key entry
  addressed to the caller**. The loser **verifies the winner's signature + decrypts their own envelope**,
  adopts the new epoch key, and **retries the original op (e.g. `sendMessage`) with no extra round-trip and no
  re-generation**.
- **Safety:** the winner's envelope is signed by the winner and wrapped to the loser's pubkey, so a malicious
  Bridge can neither forge nor substitute it (signature fails). The membership-log chain still provides
  integrity/authorization on top of the integer CAS.
- **Endpoint:** catch `ROTATED_ALREADY` → verify+decrypt the included envelope → persist new epoch key →
  retry. No second API call for the key.

## 5. Hardening (against malicious insiders)

The Bridge is blind to plaintext, so the protocol must defend against members weaponizing rotation:

- **Ghosting / selective exclusion** (rotate but silently omit Bob): the Bridge enforces **set-equality**
  coverage — every current member/grantee has exactly one key entry for the new `keyId`, none missing, none
  extra. (This is `CloudKeyService.verifyThatOnlyGivenClientsHaveAccess` / `checkKeysAndClients`, already
  implemented; it must guard **both** group key entries and container encryption-key-entry coverage on
  (re-)key.) Note: a *count* check is insufficient — must be set-equality against the actual roster/grantees.
- **Rotation spam (DoS)** (bump the generation to block sends): only managers may rotate
  (ACL on `context/groupUpdate` / `generateNewGroupKey`); auto-rotation fires **only on hard roster changes**,
  never on arbitrary client request; **rate-limit** manual rotations per (group, actor).
- **Garbage-key** (hand Bob a well-formed but wrong key): signed stamps give **attribution** (proof of *who*
  distributed the blob → evict them), but detection is otherwise **reactive** (content fails to decrypt). Add a
  **key-confirmation tag** — a MAC/hash of the new key (e.g. `MAC_newKey("confirm"||epoch)`) in the rotation
  payload — so each recipient **proactively** verifies their decrypted key equals the canonical one *before*
  adopting it. This is a cheap stand-in for MLS's `confirmation_tag`.
- **Weak-entropy injection** (rotate with bad RNG): **mandate a CSPRNG** for new keys; optionally require
  multi-party entropy. **Do NOT** derive the new group keypair from the old key — a removed member *holds* the
  old key, so KDF-blending-with-old-key (the symmetric "ratchet" trick) would **break removal forward
  secrecy** here. That trick is **symmetric-secret-only** and is incompatible with our asymmetric
  group-as-grantee model; our epoch keypairs must be **independent random**.

---

## 6. Sequencing

1. **Bridge:** add `keyVersion`/`keyHistory` to the group + epoch tag on `groupKeys`; `generateNewGroupKey`;
   switch grant role to `GroupRole {READ,WRITE,PUSH}`; keep server-enforced revocation; **atomic CAS on
   `keyVersion` + `ROTATED_ALREADY` carrying the winner's envelope (§4)**; **rotation rate-limit + manager-only
   rotation authority (§5)**. (This repo; covered by the §10 gap list in the architecture doc.)
2. **Endpoint:** group keypair + epoch bookkeeping; epoch-tagged encryption-key-entry create/select; the
   lazy-re-key-on-write algorithm (3.4); history policy (3.5); **`ROTATED_ALREADY` catch+adopt+retry (§4)**;
   **emit + verify the key-confirmation tag (§5)**.
3. **Tests:** epoch bump on removal; removed member server-blocked immediately; member added at epoch v can't
   read pre-v content unless given history; lazy re-key excludes a removed member from post-removal content;
   multi-grantee re-key wraps to each group's current epoch; **concurrent rotation → one CAS winner, losers
   adopt winner's envelope and retry**; **ghosting rejected (set-equality coverage)**; **garbage-key caught by
   confirmation tag**; **rotation rate-limit enforced**.
4. **Docs:** fold the chosen role enum + epoch model into the architecture doc.

---

## 7. What MLS-lite explicitly does NOT give (accept or revisit)
- **No post-compromise security — and the reason is our *asymmetric group-as-grantee* key, not the absence of
  MLS.** PCS comes from mixing fresh secret entropy into the key on each honest rotation; TreeKEM is only the
  O(log n) optimization for *distributing* it. A **symmetric** group ratchet (`new = KDF(old, fresh)`) gives
  PCS at **O(n)** *without* MLS — but a symmetric group key can't be a grantee target (no public key for
  outsiders to wrap to), so adopting it would cost **group-as-grantee**. The genuine tradeoff is therefore
  **group-as-grantee (asymmetric) vs PCS (symmetric ratchet)**, independent of MLS; full MLS only re-enters
  when you *also* need O(log n) scale.
- **O(members) epoch redistribution**, not O(log n) — fine for typical groups; revisit (super-groups or MLS)
  only if very large, churny groups appear.
- **Container re-key on removal is still per-grantee** (lazy, one level) — irreducible for multi-reader E2E.

---

## 8. Optional PCS upgrade (leaf keys / flat-MLS) — if PCS later becomes required

PCS (post-compromise security: a compromised member *heals* once an honest party rotates) is **not** about
mixing entropy in general — it is about delivering the fresh entropy under **per-member keys that themselves
rotate**, so a passive attacker holding an old member secret can't decrypt the next rotation. In our model
the leak that defeats PCS is the **static long-term user key** every epoch wraps to: an attacker who once
read `GKpriv_v` (by compromising a member's long-term key) keeps reading every future epoch, because every
future `GKpriv` is wrapped to that same un-healed long-term key. Mixing fresh entropy into the *group* key
doesn't help — the *delivery channel* never heals.

**Two ways to get PCS, both deferrable without touching today's design:**

| Path | Mechanism | Cost vs. today |
|---|---|---|
| **Symmetric group ratchet** | group secret `= KDF(old, freshEntropy)`; deliver fresh entropy under per-member **ephemeral leaf keys** that rotate each epoch | O(n) per rotation; client becomes **stateful** (must hold + advance leaf keys); **loses group-as-grantee** (a symmetric secret has no pubkey to wrap container keys to) |
| **Flat-MLS / pairwise** | per-member ephemeral leaf keypairs (Signal-style), Update on rotation | O(n); stateful; keeps an asymmetric layer but is a bespoke protocol to build + audit |

**Key facts to anchor the decision:**
- The thing that *enables* PCS is the **rotating per-member leaf key** + an Update operation — **not** TreeKEM.
  TreeKEM is purely the O(log n) optimization for distributing that update; flat O(n) delivery gives the same
  PCS guarantee (WhatsApp/Signal sender-keys + pairwise channels do exactly this).
- PCS protects only against a **passive** adversary who stole a secret and then sat quietly. An active
  attacker who keeps using the compromised identity to *send* is an authorization problem (revoke the device),
  not a PCS one.
- **The cost is client statefulness**, which is precisely the property MLS-lite §3.1 buys us by avoiding. So
  the moment PCS is a hard requirement, the "stateless, rebuildable-from-Bridge" win is gone regardless of
  whether you build flat-MLS or adopt full MLS.

**Recommendation:** keep the **independent-random asymmetric epoch keypair** (§1) as the default. If PCS
becomes a hard requirement, **prefer full MLS over a bespoke flat scheme** (audited libraries, see §9) rather
than hand-rolling leaf-key ratcheting — the engineering + audit cost of a custom PCS protocol is close to
adopting MLS, with none of MLS's review. Until then, the §5 hygiene (CSPRNG, optional multi-party entropy)
is the right floor — it is **not** PCS, and the doc should not claim it is.

---

## 9. Forward-compatibility: evolving lite-v1 → full MLS without breaking the data layer

**Verdict:** doing the cheap lite-v1 plan now does **not** lock you out of full MLS later. You can keep the
entire container / grant / access / data layer **non-breaking**, and avoid a *system* rewrite — **but** the
group key-agreement module itself **will** be replaced (static ECIES wraps → TreeKEM is a fundamentally
different mechanism). The goal is to make that a **contained module swap + coexistence**, not a system
rewrite, by building a few seams now. Honest framing: *no rewrite of the app/container/data layer; a
contained, unavoidable rewrite of the group-internal key subsystem.*

### 9.1 What stays non-breaking (the bulk of the system)
- **Container / grant / access / lazy-re-key layer.** It only ever needs *"the group's grant key for epoch
  e."* Keep a **stable asymmetric group grant keypair** (`groupPubKey`) as the thing containers wrap to; MLS
  only changes *how that grant private key is delivered to members* (ECIES wraps → MLS-delivered). Containers,
  `GroupGrant`/`GroupRole`, policy/ACL, server-enforced revocation, and the per-container lazy re-key (§3.4)
  are **identical** under both. This is most of the code, reusable as-is.
- **Epochs/versioning.** MLS is epoch-native; since lite-v1 already epoch-tags the group, key entries, and
  container encryption-key-entries (§2), MLS epochs map 1:1 — no schema change for versioning.
- **Bridge as orderer.** The `keyVersion` CAS + ordered, chained membership log (§4) *is* a proto
  Delivery-Service ("one commit per epoch, ordered"). MLS reuses that role; it doesn't replace it.

### 9.2 What will be rewritten (unavoidable, but contained)
- **Group key-agreement module on the endpoint:** ECIES-wrap-to-long-term-key → TreeKEM via a vetted library
  (mlspp / OpenMLS). New, stateful, but a single module behind an interface (§9.3 #1).
- **Bridge gains a KeyPackage directory + accepts MLS handshake blobs** in the same ordered log. An extension
  of the existing key-entry store, not a new subsystem.

### 9.3 Seams to build NOW (cheap insurance — indirection + a flag, no extra crypto)
1. **Interface the group key behind an abstraction (endpoint).** Container code calls
   `groupKeyProvider.keyForEpoch(g,e)` / `rotate()` / `addMember()` — **never touches raw ECIES wraps**.
   `LiteKeyAgreement` and a future `MlsKeyAgreement` both implement it. *This is the single most important
   seam* — without it, container code entangles with key delivery and you get the major rewrite.
2. **Separate the grant keypair from the membership mechanism.** Model a group as *(stable grant keypair)* +
   *(key-agreement that delivers grant-priv to members)*. Containers see only the grant keypair → MLS-agnostic.
3. **Tag the protocol per group:** `keyAgreementProtocol: "lite-v1" | "mls-v1"` on the group resource. Lets
   both coexist; the protocol is fixed at group creation.
4. **Store key-distribution payloads as opaque, epoch-ordered, protocol-tagged blobs on the Bridge.** The
   Bridge orders + signature-checks + coverage-checks by *recipient identity* but doesn't parse key internals,
   so a new blob format slots in without a storage migration.
5. **Make anti-ghosting / coverage a per-protocol strategy.** lite-v1 = set-equality of recipient entries
   (§5); mls-v1 = the protocol's `confirmation_tag` + tree integrity. A small branch, not a rewrite.

### 9.4 Caveats (don't promise these away)
- **In-place migration of an existing lite-v1 group → MLS is *not* free.** The clean non-breaking path is
  **coexistence**: existing groups stay `lite-v1`; new groups can be `mls-v1`. Migrating a specific live group
  means re-establishing its key agreement (effectively a fresh MLS group seeded from the current roster) — a
  deliberate operation, not transparent.
- **Client statefulness / device onboarding changes.** lite-v1 clients rebuild all keys by re-fetching entries
  (§3.1); MLS clients are stateful and a new device must be *added via a Commit* (or join via external Commit +
  Welcome). That's the one user-visible behavioral shift MLS forces — but it lives inside the key-agreement
  module, not the data layer.
- **PCS only arrives with the MLS swap** (or the §8 leaf-key scheme); the §5 entropy hygiene stays hygiene,
  not PCS, until then.

### 9.5 Bottom line
- **Do lite-v1 now** and build seams #1–#5. Cost: low (indirection + a protocol flag + opaque blobs).
- **Then MLS is a contained addition:** swap the key-agreement module, add a KeyPackage/handshake store, branch
  coverage enforcement — while the container / grant / ACL / policy / lazy-re-key bulk stays untouched and
  `lite-v1` groups keep working.
- **What you can't promise:** zero rewrite of the key-agreement layer itself, transparent in-place upgrade of
  existing groups, or unchanged device-onboarding UX.
