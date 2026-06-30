# 10 — Endpoint security model & alignment of the group plan

> Analysis of how **privmx-endpoint** (cloned at [../privmx-endpoint](../privmx-endpoint)) handles data
> integrity & signing today, and how that **constrains our group plan**. Governing rule (from the task):
> **existing verification takes precedence over anything new.** Where the existing model has a gap for
> groups, it is pinpointed with a concrete solution. Status legend in [README.md](./README.md).
>
> **Headline:** the endpoint already has a mature integrity stack — `DataIntegrityObject` (DIO) + the **same**
> secp256k1 / SHA-256 / 65-byte-compact signature primitive our bridge uses + a pluggable `UserVerifier`
> identity boundary + `EncKeyEncryptorV2` for key wrapping. Our bespoke `GroupMembershipSignature`
> **partially duplicates** it and should be re-based onto DIO. The **only** genuinely new things groups need —
> which DIO does *not* provide — are **(a) an append-only chain** and **(b) manager-authorization-at-the-time**.

---

## 1. The existing endpoint security model (what's there today)

### 1.1 `DataIntegrityObject` (DIO) — the universal integrity anchor
[../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/CoreTypes.hpp](../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/CoreTypes.hpp),
[DIOEncryptorV1.cpp](../privmx-endpoint/endpoint/core/src/encryptors/DIO/DIOEncryptorV1.cpp).

Every encrypted object (module data **and** key entries) carries a DIO:
```
DataIntegrityObject { creatorUserId, creatorPubKey, contextId, resourceId,
                      timestamp, randomId, containerId?, containerResourceId?, bridgeIdentity? }
ExpandedDataIntegrityObject : DIO + { structureVersion, fieldChecksums: map<field, sha256> }
```
- **`signAndEncode`**: asserts `creatorPubKey == authorKey.pub`, serializes to JSON, signs with the author's
  private key, packs `data||signature`, base64-encodes.
- **`decodeAndVerify`**: parses, then **verifies the signature against `creatorPublicKey` embedded in the DIO
  itself** → proves *"signed by whoever holds creatorPubKey"*, **not** that creatorPubKey is authorized.
- `fieldChecksums` binds SHA-256 of each encrypted field (`publicMeta`, `privateMeta`, `internalMeta`,
  `encryptedKey`, …); on decrypt each is re-checked → tamper detection.

### 1.2 Signature primitive — **already identical to our bridge's**
[../privmx-endpoint/crypto/openssl/src/ecc/ECCImpl.cpp](../privmx-endpoint/crypto/openssl/src/ecc/ECCImpl.cpp),
`PrivateKey::signToCompactSignatureWithHash`, `DataInnerEncryptorV4`.
- **ECDSA secp256k1**, **65-byte compact** (`recovery||r||s`), **SHA-256** of the message.
- Pack format: `0x01 || len(sig) || sig(65) || data`.
- This is the **same primitive** the bridge's `GroupMembershipSignature` uses (`ECUtils.signToCompactSignature`
  over `sha256(...)`). Only the *message construction* differs: DIO signs a **JSON** serialization; our log
  signs a **length-prefixed canonical buffer**. The crypto is interchangeable; the serializer is not.

### 1.3 Per-module metadata cross-check (binds DIO ↔ server-claimed metadata)
Each module mapper (e.g.
[StoreDataSchemaMapper.cpp](../privmx-endpoint/endpoint/store/src/encryptors/store/StoreDataSchemaMapper.cpp),
the thread message mapper, kvdb, inbox) after DIO signature verification checks:
`dio.contextId == server.contextId && dio.resourceId == server.resourceId && dio.creatorUserId ==
server.lastModifier && TimestampValidator.validate(dio.timestamp, server.lastModificationDate)`
(messages also check `containerId == threadId`). **So the bridge cannot lie about who-modified / which-resource
without breaking the DIO match.**

### 1.4 `UserVerifier` — the identity/authorization boundary
[../privmx-endpoint/endpoint/core/include_pub/privmx/endpoint/core/UserVerifierInterface.hpp](../privmx-endpoint/endpoint/core/include_pub/privmx/endpoint/core/UserVerifierInterface.hpp),
invoked from `KeyProvider::verifyUserData` and every module's `validateDecryptAndConvert*`.
```
VerificationRequest { contextId, senderId, senderPubKey, date, bridgeIdentity? }
std::vector<bool> verify(const std::vector<VerificationRequest>&)
```
- After integrity passes, the endpoint asks the **application-provided verifier**: *"is `senderPubKey` really
  `senderId`'s key in this context at `date`?"* Failure ⇒ `statusCode = UserVerificationFailureException
  (0x000E)`.
- **The default impl returns all-`true` with a warning** — insecure by design; real deployments MUST supply a
  verifier backed by a trusted PKI/app server ([DefaultUserVerifierInterface.hpp](../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/DefaultUserVerifierInterface.hpp)).
- The user→pubKey list itself comes from the **untrusted bridge** (`ConnectionImpl::listContextUsers` →
  `_serverApi->contextListUsers`); the `UserVerifier` is the *only* thing that makes that binding trustworthy.

### 1.5 Key wrapping — `EncKey` + `EncKeyEncryptorV2`
[KeyProvider.cpp](../privmx-endpoint/endpoint/core/src/KeyProvider.cpp),
[EncKeyEncryptorV2.cpp](../privmx-endpoint/endpoint/core/src/encryptors/EncKey/EncKeyEncryptorV2.cpp).
- `EncKey {id = hex(16 rand), key = 32 rand}`; wrapped **per recipient via ECIES** to their pubkey; signed
  with a DIO; `keySecret`/`secretHash = HMAC(containerSecret, keySecret||contextId||resourceId)` binds the key
  to its `EncKeyLocation {contextId, resourceId}`.
- On decrypt: DIO verified, checksums verified, `secretHash` recomputed, duplicate `(randomId,timestamp)`
  rejected, **then `UserVerifier`**.
- **No key history/epoch today** — a container points at one active `keyId`; "rotation" = generate a new
  `keyId`.

### 1.6 Verification surfacing
Internal `enum DataIntegrityStatus { NotValidated, ValidationFailed, ValidationSucceed }`
([ContainerProvider.hpp](../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/ContainerProvider.hpp));
public API exposes `int64_t statusCode` per object (`0` = fully verified, non-zero = the failing exception
code). `bridgeIdentity` in the DIO is forwarded to the verifier as an anti-bridge-substitution signal.

---

## 2. Precedence ruling — what the group plan must REUSE (not reinvent)

Per "existing verification takes precedence", every group artifact maps onto an existing mechanism:

| Group artifact | Reuse this existing mechanism | Was our plan inventing? |
|----------------|-------------------------------|--------------------------|
| Group **resource data** (`data`/meta) | `ModuleDataEncryptorV5` + a `GroupDataSchemaMapper` (DIO, `containerId=null`) | no — already implied |
| Group **data-key entries** (group key → members) | `EncKeyEncryptorV2` (DIO + `EncKeyLocation`) | no |
| Container **encryption-key-entries** (`CK` → `groupPubKey`) | `EncKeyEncryptorV2`, recipient = `groupPubKey` | no |
| **Author/manager identity** verification | `UserVerifier` (`VerificationRequest`) | **yes — our plan said "verify signer against authorPubKey"; that's only half. MUST route through `UserVerifier`** |
| **Per-entry signing** of membership ops | DIO signing primitive (§1.2) | **yes — `GroupMembershipSignature` is a 2nd serializer; re-base on DIO** |
| **Verification surfacing** | `statusCode` | no |
| **Anti-bridge-substitution** | DIO `bridgeIdentity` | not in our plan — **adopt it** |

**Verdict on `GroupMembershipSignature`:** keep the *concept* (a signed membership log) but **stop treating it
as a standalone crypto scheme**. The signing + author-identity verification must reuse DIO + `UserVerifier`.
What remains genuinely new is only the **chain** and the **role check** (§3, G1/G2).

---

## 3. Gaps in the existing model for groups — with solutions

The DIO/`UserVerifier` stack is **per-object** integrity + identity. Groups need two things it does not provide.

### G1 — No append-only **chain / ordering** (DROP & REORDER are undetectable)
**Gap.** A DIO has `timestamp` + `randomId` and a duplicate check, but **no link to a predecessor**. If the
untrusted bridge **drops** or **reorders** membership updates, every *surviving* DIO still verifies and still
matches its server metadata — nothing detects the missing/transposed step. `UserVerifier` can't see it either.
**Why it matters for groups (not for a thread message):** a dropped "remove Bob" or a reordered "promote Mallory"
silently changes who has access. Single-object integrity is insufficient for an evolving authorization set.
**Solution.** Keep the `prevSignature` chain, but carry it **inside the DIO-protected membership entry**: the
membership-log entry is a DIO-signed object whose (public) fields include `op`, `resultUsers`,
`resultManagers`, `groupPubKey`, `keyId`, **and `prevSignature`** (= the prior entry's signature/blob hash),
all covered by `fieldChecksums`. The client, during replay, verifies `entry[i].prevSignature == hash(entry[i-1])`.
The **bridge** enforces the same link on write (`prevSignature == head`, comparable on opaque bytes — already
implemented as the chain-link check). This is the one new property; everything else is DIO.

### G2 — No **role / authorization-at-the-time** (manager check)
**Gap.** `UserVerifier` answers *"is this pubkey this user's key in this context at this date?"* — it does
**not** answer *"was this user a **manager** of this group, authorized to change membership, at that point?"*
The per-module check only validates the **current** `lastModifier`, and the endpoint otherwise **trusts the
bridge-served `users`/`managers` lists**. So a malicious bridge could present a membership state implying a
non-manager made a change, and nothing cryptographic rejects it.
**Solution (client-side, new — our EP-3 must keep this):** replay the chain genesis→head and, for each entry,
verify `dio.creatorUserId` ∈ the **managers set of the prior verified entry** (inductive authorization; genesis
is self-authorizing as the creator). This is the membership-authorization logic that neither DIO nor
`UserVerifier` covers and that justifies the signed log's existence.

### G3 — Historical signers aren't identity-verified; default verifier is permissive
**Gap.** `UserVerifier` is invoked for the **current** object's sender. For a membership chain, **each
historical entry's signer** (`authorPubKey` at that `timestamp`) must also be a verified identity — otherwise a
forged historical `authorPubKey` (with a matching forged signature) would pass crypto but be an unknown
identity. Also, the **default verifier accepts everything** — a pre-existing, deployment-wide posture.
**Solution.** Group log verification must issue a `VerificationRequest` for **every distinct `(author,
authorPubKey, timestamp)` in the chain**, not just the head — reusing the same `UserVerifier` the rest of the
SDK uses. Document loudly (already true for all modules) that **a real `UserVerifier` is mandatory**; the group
feature inherits, and amplifies, that requirement because authorization is historical.

### G4 — `groupPubKey` as a grantee is a **group** identity, but `UserVerifier` verifies **users**
**Gap.** When a container key is wrapped to `groupPubKey` (group-as-grantee), the "recipient" is a group, not a
user. The DIO/`UserVerifier` model verifies the **author** who wrapped the key, but has **no notion of "this
`groupPubKey` legitimately represents group G's current membership"**. A malicious bridge could swap the
`groupPubKey` a container points at.
**Solution.** Treat `groupPubKey` as a **verified artifact of the group's signed log**, not a value to trust
from the container record: (1) the client resolves the group's *current* `groupPubKey` by verifying the group's
membership chain (G1+G2), and (2) on reading a group-granted container, it confirms the container's
encryption-key-entry author is authorized to grant **and** that the `groupPubKey` it wrapped to equals the one
the verified group log attests. The group↔pubKey binding is anchored by the log, not by `UserVerifier`.

### G5 — Epoch ↔ key binding (Phase 2)
**Gap.** Phase-2 epochs (`keyVersion`/`keyHistory`) are new metadata; per-epoch group key entries reuse
`EncKeyEncryptorV2` (fine), but nothing binds *"epoch e ↔ this `groupPubKey`"* cryptographically.
**Solution.** Make the `generateNewGroupKey`/rekey op a **DIO-signed membership-log entry** (G1) that binds the
new `groupPubKey` + `keyVersion`. Then epoch→pubKey inherits the chain's integrity + role check for free.

---

## 3b. DECISION (applied in code) — drop GroupMembershipSignature; fold integrity into `data`

The team chose the most aggressive form of the precedence ruling: **`GroupMembershipSignature` is removed and
the bridge no longer signs or verifies anything for groups.** The membership proof (author signature + member
set + chain link) is committed **inside the opaque `data` blob** as the endpoint's DIO and verified entirely
client-side. The bridge stores group state + the append-only version `history` and enforces only ACL,
key-coverage, the `version` optimistic-concurrency check, and `GROUP_IN_USE`.

This is **done on the bridge** (branch `feat/group-api`): `GroupMembershipSignature.ts` deleted; `signature`/
`prevSignature` removed from the API, validators, DB model, repository, and `GroupService` (no
`verifyAndBuildSignature`/`checkChainLink`); `GroupSignatureOp`/`GroupMembersDelta` removed;
`GroupSignedEntry` → `GroupHistoryEntryInfo` (reduced). `tsc`/eslint clean; unit suites green. The remaining
work (§4) is all **endpoint**: it must put the chain link + member commitment into the group `data` DIO and run
the §3 verification (G1/G2/G3/G4) on read.

## 4. Concrete impact on the plan (what to change)

**The primitive already matches** (§1.2) — so re-basing onto DIO is *less* endpoint work, not more (the
endpoint reuses `DIOEncryptorV1`/`EncKeyEncryptorV2`/`UserVerifier` it already ships and tests).

1. **Bridge — [02-bridge-api-contract.md](./02-bridge-api-contract.md) §7 & [04](./04-bridge-implementation.md) §2 (REVISE):**
   Re-base the membership-log signature on the **DIO model** instead of the bespoke `PMX_GROUP_SIG`
   length-prefixed canonical buffer. The membership entry becomes a DIO-signed object (public fields:
   `op, resultUsers, resultManagers, groupPubKey, keyId, prevSignature`; DIO binds `creatorUserId/PubKey,
   contextId, resourceId=groupId, timestamp, randomId, bridgeIdentity`). Consequence: the **bridge stops
   cryptographically verifying the signature itself** (it never verifies DIOs — that's the client's job) and
   retains only **ACL + chain-link (`prevSignature == head`) + coverage**. *(Trade-off: we lose the
   defense-in-depth server-side signature check against the authenticated session pubkey. Acceptable — the
   bridge is untrusted by definition and ACL already gates who may write. If we want to keep it, the bridge
   would have to parse the DIO JSON; not recommended.)*
   - This is a change to **already-implemented** bridge code (`GroupMembershipSignature.ts`,
     `GroupService.verifyAndBuildSignature`). It can be done now or scheduled; flag it explicitly.

2. **Endpoint — [06-endpoint-client-guide.md](./06-endpoint-client-guide.md) §4/§5 and [09](./09-endpoint-issues-and-roadmap.md) EP-2/EP-3/EP-6 (REFRAME):**
   - EP-2 (sign): **reuse `DIOEncryptorV1.signAndEncode`** for membership entries — do **not** implement a
     second serializer. EP-6's "shared canonical test vectors" shrinks to "the membership entry's DIO JSON +
     extra public fields" (the signature primitive is already shared/tested).
   - EP-3 (verify): **reuse `decodeAndVerify` + `UserVerifier`** for per-entry signature + identity; the **only
     new code** is the **chain-link replay (G1)** + **manager-authorization induction (G2)** + **per-entry
     `UserVerifier` calls (G3)**.
   - Add a new endpoint issue **EP-15 — resolve & verify `groupPubKey` from the group log (G4)** and bind it
     into the group-as-grantee read/grant path (EP-4).
   - Phase-2 **EP-10/BR-2**: the rekey op must be a DIO-signed log entry (G5).

3. **Adopt `bridgeIdentity`** in the group DIOs (anti-bridge-substitution) — it's free, the field exists, and
   the verifier already consumes it.

4. **Mandatory `UserVerifier`** — call out in [07](./07-backward-compatibility-and-migration.md)/[09](./09-endpoint-issues-and-roadmap.md)
   that groups are only as safe as the app's `UserVerifier`; the default (all-true) makes the entire group
   authorization story void. This is pre-existing but groups raise the stakes (historical authorization).

---

## 5. Net assessment

- **Reuse, don't reinvent:** signing primitive, per-object integrity, per-field checksums, identity
  verification, key wrapping, and status surfacing all **already exist and are audited**. Our plan should ride
  on `DIOEncryptorV1` + `EncKeyEncryptorV2` + `UserVerifier`, not on a parallel `GroupMembershipSignature`
  scheme.
- **Two real gaps, both client-side and both small:** (G1) append-only **chain** and (G2)
  **manager-authorization-at-the-time** — neither is provided by DIO/`UserVerifier`, and together they are the
  entire justification for a signed membership *log* (vs. signed *objects*). (G3) historical-signer
  verification and (G4) group-pubKey-from-log are corollaries that reuse existing machinery with new wiring.
- **Plan changes are reductive on the endpoint** (less bespoke crypto) and **localized on the bridge** (drop
  server-side signature verify; keep ACL + chain-link + coverage). The biggest concrete edit is re-basing
  [02](./02-bridge-api-contract.md) §7 from `PMX_GROUP_SIG` to a DIO-shaped entry.
- **Unchanged truth:** without a real `UserVerifier`, none of this is secure — that's the existing posture,
  and groups inherit it with higher stakes.
