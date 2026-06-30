# 03 — Read-path verification (the endpoint is the only verifier)

Because the bridge verifies nothing, **the endpoint is the entire security boundary**. On every
`getGroup`/`listGroups` the endpoint must replay and verify the group's whole version history before trusting
its members/keys. This combines the existing per-object DIO checks (reused) with the two new group-specific
checks **G1 (chain)** and **G2 (manager-authorization)**, plus identity via `UserVerifier` (**G3**) and the
group-pubkey binding (**G4**). See [../plan/10-endpoint-security-model-and-alignment.md](../plan/10-endpoint-security-model-and-alignment.md) §3.

---

## 1. Inputs from the bridge
`GroupInfo` carries, per version `i = 0..N` (genesis → head):
- `data[i] = { keyId, data }` — the signed encrypted blob holding the DIO + `membership` block.
- `history[i] = { keyId, groupPubKey, users, managers, created, author }` — the bridge's **plaintext mirror**
  (used for access; **must be cross-checked**, never trusted alone).
- top-level `users`/`managers`/`groupPubKey`/`version` — the bridge's claim of the current state.
- `keys` — the caller's `Gk` entries.

The caller can only *decrypt* versions whose `Gk` it holds, but it can *verify signatures + chain + member
sets* on **every** version because the DIO and `membership` block are signed and (for `membership`) committed;
make `membership` plaintext-readable-but-signed if you want non-members/auditors to verify membership without
the data key. (Recommended: `membership` is signed + plaintext; `groupPrivKey`/`privateMeta` are encrypted.)

---

## 2. The verification algorithm (run on read)

```
verifyGroup(GroupInfo g):
  verifiedManagers = ∅
  prevHash = null
  for i in 0..N:                                   # genesis → head
     dio_i = DIOEncryptorV1.decodeAndVerify(g.data[i].data)        # (A) DIO signature vs creatorPubKey  [reused]
     assertFieldChecksums(dio_i, g.data[i])                        # (B) per-field integrity            [reused]
     m_i = decode(membershipFieldOf(g.data[i]))                    # the signed membership block
     # (B') membership is covered by dio_i.fieldChecksums -> tamper-proof

     # (A2) DIO ↔ server metadata cross-check (reused pattern from *DataSchemaMapper)
     assert dio_i.contextId == g.contextId
     assert dio_i.resourceId == g.groupId
     assert dio_i.creatorUserId == g.history[i].author
     assert TimestampValidator.validate(dio_i.timestamp, g.history[i].created)

     # (G1) chain link
     assert m_i.prevEntryHash == prevHash                          # genesis: null
     prevHash = sha256(g.data[i].data)                             # canonical bytes of THIS signed entry

     # (G2) manager-authorization-at-the-time
     if i == 0:
        # genesis: creator authorizes itself; creator must be in its own managers set
        assert dio_i.creatorUserId ∈ m_i.managers
     else:
        assert dio_i.creatorUserId ∈ verifiedManagers              # signer was a manager in the PRIOR verified state
     verifiedManagers = m_i.managers                               # advance the authorized set

     # member-set cross-check: bridge plaintext must equal the signed set
     assert sameSet(g.history[i].users, m_i.users)
     assert sameSet(g.history[i].managers, m_i.managers)
     assert g.history[i].groupPubKey == m_i.groupPubKey
     assert g.history[i].keyId == m_i.keyId

  # head consistency: the bridge's top-level claim must equal the last verified version
  assert sameSet(g.users, verifiedUsersAtHead) && sameSet(g.managers, verifiedManagers)
  assert g.groupPubKey == m_N.groupPubKey && g.version == N+1

  # (G3) identity verification for EVERY distinct signer in the chain
  reqs = distinct( {contextId: g.contextId, senderId: dio_i.creatorUserId,
                    senderPubKey: dio_i.creatorPubKey, date: dio_i.timestamp,
                    bridgeIdentity: dio_i.bridgeIdentity} for i in 0..N )
  results = UserVerifier.verify(reqs)               # app-provided; default impl = all true (INSECURE)
  if any(results == false): statusCode = UserVerificationFailureException

  # (G4) the group identity others wrap to is the verified one
  # callers granting/reading containers MUST use g.groupPubKey only after this verification succeeds
```

Steps **(A)/(B)/(A2)/(G3)** are exactly what `ModuleDataEncryptorV5` + the per-module `*DataSchemaMapper`
already do for thread/store; reuse them. **(G1)/(G2)** and the member-set cross-check are the new group code.

---

## 3. Surfacing the result — `statusCode`
Mirror thread/store: each decrypt/verify path is wrapped in try/catch; on any failure set the public
`Group::statusCode` to the failing exception's code (non-zero), else `0`. Internally you may cache a
`core::DataIntegrityStatus { NotValidated, ValidationFailed, ValidationSucceed }` in `GroupProvider` so a
verified group isn't re-replayed every call (see doc 03 §5 of the plan's
[06-endpoint-client-guide.md](../plan/06-endpoint-client-guide.md) for the cached-head optimization — 🟡, can
skip in Phase 1 and just replay).

New group exceptions to define (mirror `*DataIntegrityException`): `GroupDataIntegrityException`,
`GroupChainBrokenException` (G1), `GroupUnauthorizedSignerException` (G2), `GroupMembershipMismatchException`
(member-set cross-check). Reuse `UserVerificationFailureException` (G3).

---

## 4. Why both G1 and G2 are required (don't skip either)
- **Without G1 (chain):** the bridge could **drop** or **reorder** versions; each surviving DIO still verifies
  and still matches its own `history[i]` mirror — undetected. The chain makes a missing/transposed version
  break `prevEntryHash`.
- **Without G2 (manager-auth):** a malicious bridge could present a version `authored` by a non-manager (with
  a valid self-signature and a forged identity). G2 ties each version's signer to the managers set of the
  *prior verified* version, so authorization is inductive from a genesis the app trusts.
- **G3 (UserVerifier)** turns "signed by *someone* holding this pubkey" into "signed by *this user*" — the
  bridge supplies the user→pubkey list and is untrusted, so a real `UserVerifier` is **mandatory**; the
  default returns all-true and voids the whole guarantee.

---

## 5. Mandatory deployment note
Phase 1 security is only real if the application installs a non-default `UserVerifier`
([../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/DefaultUserVerifierInterface.hpp](../privmx-endpoint/endpoint/core/include/privmx/endpoint/core/DefaultUserVerifierInterface.hpp)
returns all-true with a warning). Document this prominently in the group API docs: **groups are only as
trustworthy as the app's `UserVerifier`** — and for groups the stakes are higher because authorization is
*historical* (every signer in the chain is verified, not just the latest writer).
