# Endpoint Phase 1 — make groups work (privmx-endpoint, C++)

This directory specifies **what the privmx-endpoint (C++) library must implement** so the Group feature works
end-to-end against the **current bridge** (which, after the latest change, just *stores* group data — it does
**not** sign or verify anything). It also describes **how existing flows change**.

It is the actionable, C++-grounded companion to the bridge plan in
[../plan/](../plan/) — specifically [../plan/02-bridge-api-contract.md](../plan/02-bridge-api-contract.md)
(contract), [../plan/06-endpoint-client-guide.md](../plan/06-endpoint-client-guide.md) (high-level client
design) and [../plan/10-endpoint-security-model-and-alignment.md](../plan/10-endpoint-security-model-and-alignment.md)
(why we reuse DIO/`UserVerifier`, and the gaps G1–G5). Read those for *why*; read this for *how, in this
codebase*.

The endpoint source analysed here is the clone at [../privmx-endpoint](../privmx-endpoint).

---

## Phase 1 scope (and non-scope)

**In scope — "groups work":**
- A `group::GroupApi` C++ module (create / update / delete / get / list) talking to `context.group*`.
- Generating the **group identity keypair**, distributing the group **data key** to members, and committing
  the **membership proof (member set + chain link) inside the group `data` via a `DataIntegrityObject`** —
  reusing the existing DIO + `EncKeyEncryptorV2` + `KeyProvider` machinery (no new crypto).
- **Client-side verification** on read: replay the version history, verify each version's DIO + chain link +
  manager-authorization, route identity through `UserVerifier`, surface `statusCode`.
- **Group-as-grantee** in the 5 container modules (thread/store/inbox/kvdb/stream): grant a group, read a
  group-granted container, and re-key (full) when group membership changes.

**Out of scope — Phase 2 (see [../plan/09-endpoint-issues-and-roadmap.md](../plan/09-endpoint-issues-and-roadmap.md) "Phase 2"):**
- Key **epochs** (`keyVersion`/`keyHistory`), `generateNewGroupKey`, optimistic CAS + `ROTATED_ALREADY`.
- **Lazy re-key on write** and cryptographic **forward secrecy** of container content.
- Delta `modifyMembers` (membership changes are **full-replace `groupUpdate`** in Phase 1).
- Post-compromise security, ratchet trees.

> Phase 1 gives **server-enforced revocation** (a removed member is refused immediately by the bridge) and
> **client-verifiable, manager-authorized membership**. It does **not** yet give cryptographic forward secrecy
> of already-shared container content — that's Phase 2's lazy re-key.

---

## Reuse map — almost nothing is new crypto

| Group need | Reuse this existing endpoint component |
|------------|----------------------------------------|
| Sign/verify a data object's integrity | `DIOEncryptorV1` ([../privmx-endpoint/endpoint/core/src/encryptors/DIO/DIOEncryptorV1.cpp](../privmx-endpoint/endpoint/core/src/encryptors/DIO/DIOEncryptorV1.cpp)) |
| Module data encrypt/decrypt + field checksums | `ModuleDataEncryptorV5` ([.../module/ModuleDataEncryptorV5.cpp](../privmx-endpoint/endpoint/core/src/encryptors/module/ModuleDataEncryptorV5.cpp)) |
| Wrap a key to a recipient pubkey (ECIES + DIO) | `EncKeyEncryptorV2` ([.../EncKey/EncKeyEncryptorV2.cpp](../privmx-endpoint/endpoint/core/src/encryptors/EncKey/EncKeyEncryptorV2.cpp)) |
| Generate/distribute/verify container keys | `KeyProvider` ([../privmx-endpoint/endpoint/core/src/KeyProvider.cpp](../privmx-endpoint/endpoint/core/src/KeyProvider.cpp)) |
| Identity (userId ↔ pubKey) verification | `UserVerifierInterface` ([.../core/include_pub/.../UserVerifierInterface.hpp](../privmx-endpoint/endpoint/core/include_pub/privmx/endpoint/core/UserVerifierInterface.hpp)) |
| ECC signing primitive | secp256k1 / SHA-256 / 65-byte compact (`PrivateKey::signToCompactSignatureWithHash`, `ECCImpl`) |
| Module API shape to mirror | `thread::ThreadApiImpl` ([../privmx-endpoint/endpoint/thread/src/ThreadApiImpl.cpp](../privmx-endpoint/endpoint/thread/src/ThreadApiImpl.cpp)) |

**The only genuinely new logic** (per [../plan/10-endpoint-security-model-and-alignment.md](../plan/10-endpoint-security-model-and-alignment.md) §3):
- **G1** — an append-only **chain link** between group versions (DIO is per-object; it has no ordering).
- **G2** — **manager-authorization-at-the-time**: each version's signer must have been a manager in the prior
  verified state.
Everything else (signing, per-field integrity, identity verification, key wrapping) is reused.

---

## Reading order

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [01-modules-and-files.md](./01-modules-and-files.md) | The C++ classes/files to add (and which to mirror) |
| 2 | [02-keys-and-integrity.md](./02-keys-and-integrity.md) | Group keypair, data key, the membership proof in the `data` DIO, key distribution |
| 3 | [03-verification.md](./03-verification.md) | Read-path verification (history replay, chain, manager-auth, `UserVerifier`, `statusCode`) |
| 4 | [04-group-as-grantee.md](./04-group-as-grantee.md) | Container module changes (5 modules) + re-key reconciliation |
| 5 | [05-flows.md](./05-flows.md) | **How flows change** — before/after, with diagrams |

---

## Bridge contract recap (what the endpoint talks to)

- `context.groupCreate { contextId, resourceId?, type?, groupPubKey, users, managers, data, keyId, keys[],
  policy? } → { groupId }` — **no `signature` field**.
- `context.groupUpdate { id, groupPubKey, users, managers, data, keyId, keys[], version, force, policy? } → OK`
  — full replace; `version` is optimistic-concurrency (= `history.length`); **no `signature`/`prevSignature`**.
- `context.groupGet/groupList` → `GroupInfo` incl. the full `history: GroupHistoryEntryInfo[]`
  (`{keyId, groupPubKey, users, managers, created, author}` per version) and `data: GroupDataEntry[]`
  (`{keyId, data}` per version — **this is where the DIO lives**), `keys` filtered to the caller.
- `context.groupDelete` → OK (or `GROUP_IN_USE`).
- Container `*Create`/`*Update` accept optional `groups: [{groupId, role}]` + `groupKeys: [{group, keyId,
  data}]`.

The bridge stores all of this opaquely and enforces only ACL, key-coverage, `version` CAS, and `GROUP_IN_USE`.
**All integrity/identity verification is the endpoint's job** (docs 02/03).
