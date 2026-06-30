# 02 — Rotation, CAS retry & key-confirmation (EP-10, EP-11, EP-12)

How the endpoint mints new epochs, survives concurrent rotations, and proves the new key is the canonical one.

---

## 1. Mint a fresh epoch (EP-10) — always via `generateNewGroupKey`

> **Rotation is decoupled from membership.** The bridge does **not** rotate on a `groupUpdate` removal —
> `groupUpdate` is membership-only and cannot change `groupPubKey`. **All** epoch rotation goes through
> `context.groupGenerateNewKey` (which cannot add/remove members). So a **secure removal is two calls**:
> `groupUpdate` (drop the member, rotate the *data* key) **then** `generateNewGroupKey` (rotate the *identity*
> epoch). Forced rekey / compromise recovery is just the second call on its own.

Triggered by: forward secrecy after a removal, compromise recovery, or forced freshness. Bridge dependency:
**BR-2** (`generateNewGroupKey` RPC), **BR-3** (CAS).

```
// step 1 (removal only) — membership change, identity UNCHANGED:
//   context.groupUpdate { users'(−removed), groupPubKey: g.currentGroupPubKey (SAME), keyId'(new data key), keys'(remaining), version }

// step 2 — the rotation (also used standalone for forced rekey):
rotateGroup(g):
   (GroupPub', GroupPriv') = generateKeyPair()        # INDEPENDENT random — not derived from epoch e
   Gk' = generateKey()                                # fresh data key, new keyId'
   e'  = g.currentEpoch + 1
   membership' = { users, managers, groupPubKey: GroupPub', keyId: keyId', keyVersion: e', prevEntryHash: H }
   data' = GroupDataEncryptorV5.encrypt({publicMeta, privateMeta, groupPrivKey: GroupPriv', membership'}, Gk', myPriv)
   keys' = wrap Gk' to each CURRENT member (EncKeyEncryptorV2)       # the just-removed member is no longer a member
   confTag = MAC_{Gk'}("confirm" || groupId || e' || keyId')         # EP-12
   → context.groupGenerateNewKey { id, groupPubKey: GroupPub', data: data', keyId: keyId', keys: keys',
                                   expectedKeyVersion: g.currentEpoch, confirmationTag: confTag }
```

- `generateNewGroupKey` wraps the new epoch **only to current members** (the removed member is already gone
  after step 1), so they cannot obtain `Gk'`/`GroupPriv'` → cannot read epoch-`e'` content. Forward secrecy of
  *group* content achieved.
- Container content the group grants into is handled separately by **lazy re-key**
  ([03-lazy-rekey.md](./03-lazy-rekey.md)).

---

## 2. `ROTATED_ALREADY` — adopt the winner, retry (EP-11)

If two managers rotate from the same epoch, the bridge CAS lets exactly one win; the loser gets
`ROTATED_ALREADY` carrying the winner's key entry for the caller (**BR-3**).

```
on ROTATED_ALREADY { keyVersion: e'', groupPubKey'', winnerKeyEntry }:
   # winnerKeyEntry is the winner's Gk'' wrapped to ME, integrity-protected by the winner's DIO
   verify winnerKeyEntry  (DIO signature + checksums + secretHash + UserVerifier on its author)   # reuse KeyProvider verify
   Gk''       = decrypt(winnerKeyEntry, myPriv)
   # fetch the winning version's data to get GroupPriv'' + verify confirmation tag (below)
   getGroup(g) ; verify history ; GroupPriv'' = decrypt(data_head, Gk'')
   verifyConfirmationTag(Gk'', e'', keyId'')                                                       # EP-12
   epochKeys[e''] = { groupPriv: GroupPriv'', dataKey: Gk'' } ; currentEpoch = e''
   retry the original op (e.g. the removal, or the container write) against epoch e''
```

No second key-fetch round trip for the key itself — the envelope is in the rejection. Only re-fetch the
group head if you need `GroupPriv''`/full verification (recommended).

---

## 3. Key-confirmation tag (EP-12) — proactive anti garbage-key

A malicious rotator could hand some members a **well-formed but wrong** key. Confirmation makes this
detectable **before** adopting, not on first decrypt failure.

- **Emit (on rotate):** `confTag = MAC_{newKey}("confirm" || groupId || epoch || keyId)`. Submit it with the
  rotation; the bridge stores/serves it opaquely (it's just a blob to the bridge).
- **Verify (on adopt, every recipient):** after decrypting your `Gk_e` entry, recompute the MAC and require it
  to equal the served `confTag`. Mismatch ⇒ reject the rotation as tampered (do **not** adopt; surface
  `statusCode`/error, and the group can treat the rotator as malicious).
- This is the cheap stand-in for MLS's `confirmation_tag` ([../group-mls-lite-plan.md](../group-mls-lite-plan.md)
  §5). It confirms *the symmetric key everyone got is the same canonical one*; it does not replace the DIO
  signature (which proves *who* rotated).

---

## 4. Rate-limit awareness (BR-4)
The bridge throttles rotations per `(group, actor)` and rejects non-managers. The endpoint should:
- surface the rate-limit/`ACCESS_DENIED` error rather than hammering;
- never auto-rotate in a tight loop — rotation is triggered by roster changes or explicit user/admin action.

---

## 5. Independent-random epochs — do NOT KDF-chain them
A removed member *holds* epoch `v`'s keys. Deriving `v+1` from `v` (a hash/KDF ratchet) would let them compute
the next epoch and **break removal forward secrecy** in this asymmetric model. Each epoch keypair + data key
is **fresh CSPRNG randomness**. (Mixing fresh entropy is fine; deriving *from the old key* is not. This is the
corrected conclusion from [../group-mls-lite-plan.md](../group-mls-lite-plan.md) §5/§7.)

---

## 6. Reused / new
- **Reused:** `KeyProvider`/`EncKeyEncryptorV2` verify path (for adopting `winnerKeyEntry`), DIO verify,
  `UserVerifier`, the ECC/MAC primitives.
- **New:** the rotate builder (fresh epoch, wrap-to-remaining), the `ROTATED_ALREADY` catch-adopt-retry, and
  the confirmation-tag emit/verify.
