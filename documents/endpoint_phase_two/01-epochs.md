# 01 — Epoch bookkeeping (EP-9, EP-14)

The endpoint state model gains epochs. Everything here remains **rebuildable from the bridge** — no
commit-replay engine, no resync handshake. Bridge dependency: **BR-1** (the group carries `keyVersion` +
`keyHistory`; container key entries carry `groupEpoch`).

---

## 1. Per-group epoch state

Replace the Phase-1 single `(GroupPub, GroupPriv, Gk)` with epoch-indexed state:

```
GroupState {
  groupId
  currentEpoch          // = bridge keyVersion, cross-checked against the DIO-committed membership.keyVersion
  currentGroupPubKey    // = GroupPub_currentEpoch
  epochKeys: Map<epoch, { groupPriv: GroupPriv_e, dataKey: Gk_e }>   // ONLY the epochs this member is entitled to
}
```

- An **independent random** keypair + data key per epoch (NOT derived from the previous epoch — a removed
  member holding epoch `v` must not be able to compute `v+1`).
- `epochKeys` holds only what the member can decrypt: each epoch's `Gk_e` comes from that epoch's key entry
  addressed to them; `GroupPriv_e` is decrypted from that epoch's group `data` (it's stored inside `data`
  under `Gk_e`, exactly as in Phase 1 — [../endpoint_phase_one/02-keys-and-integrity.md](../endpoint_phase_one/02-keys-and-integrity.md)).

---

## 2. Rebuilding state from the bridge (no mandatory persistence)

On `getGroup` (and after being offline through N rotations):
1. Verify the group history (Phase-1 algorithm + the epoch cross-check below).
2. For each `history` entry / key entry the member is addressed in, decrypt that epoch's `Gk_e`, then the
   epoch's `data` → `GroupPriv_e`; populate `epochKeys`.
3. Set `currentEpoch = keyVersion`, `currentGroupPubKey = groupPubKey`.

If the member joined at epoch `k`, they only get `epochKeys` for `e ≥ k` (and any past epochs the granter
chose to share — history policy, Phase-1 doc 06 §... / [../group-mls-lite-plan.md](../group-mls-lite-plan.md)
§3.5). **No bricking:** losing local state just means re-fetching and rebuilding.

> Caveat vs Phase 1: the client must now *retain or re-fetch* the **set** of entitled epoch keys, not just one
> current key. It's still all derivable from bridge-served, epoch-tagged key entries — so the "rebuildable"
> property holds; it's just a map instead of a single value.

---

## 3. Read selection — pick the right epoch key (EP-14)

When reading group content or a group-granted container, select the key entry by its epoch:

```
readGroupContent(version i):
   e = membership[i].keyVersion           // the epoch this version was encrypted under (committed in DIO)
   Gk_e = epochKeys[e].dataKey            // I hold it iff I was a member at epoch e
   decrypt data[i] with Gk_e

resolveContainerCK(container, group g):
   E = container.groupKeys(g).groupEpoch  // epoch the CK was wrapped to (bridge-stored tag, BR-1)
   GroupPriv_E = epochKeys[E].groupPriv    // I hold it iff I was a member at epoch E
   CK = ECIES-decrypt(container.groupKeys(g).data, GroupPriv_E)
```

If the member lacks `epochKeys[E]` (joined after that epoch and wasn't given history) → they correctly cannot
read that (older) content. `keyHistory` (BR-1) lets them map `E → GroupPub_E` for verification/labelling even
when they can't decrypt.

---

## 4. Epoch committed in the DIO (verification cross-check)

Phase 2 extends the Phase-1 `membership` block with `keyVersion`:

```
membership = { users, managers, groupPubKey, keyId, keyVersion, prevEntryHash }   // + keyVersion
```

During the Phase-1 history replay ([../endpoint_phase_one/03-verification.md](../endpoint_phase_one/03-verification.md)),
add:
- `membership[i].keyVersion` is **monotonic non-decreasing** across versions; it **increments exactly when**
  `groupPubKey` changes (a `generateNewGroupKey` rotation) and stays equal across **all `groupUpdate`s**
  (adds *and* removes — `groupUpdate` never rotates the identity key).
- cross-check the bridge's top-level `keyVersion` == `membership[head].keyVersion` and each
  `keyHistory[].groupPubKey` matches the `groupPubKey` committed at that epoch's first version.

This makes the bridge's CAS field (`keyVersion`) and `keyHistory` **client-verifiable**, not just trusted —
the bridge can't lie about which pubkey an epoch used.

---

## 5. What's reused / new
- **Reused:** the Phase-1 group `data` layout (`GroupPriv` + `membership` inside `data`), DIO verify, key
  wrap/unwrap, `UserVerifier`.
- **New:** the `epoch → key` map, the `keyVersion` field in the committed `membership`, epoch-tagged selection
  on read, and the monotonic-epoch checks in the replay.
