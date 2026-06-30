# 03 — Lazy re-key on write (EP-13) — the heart of Phase 2

This is the one genuinely new algorithm in Phase 2 and the thing that delivers **forward secrecy of container
content**. Bridge dependency: **BR-1** (`groupEpoch` tags + group `keyVersion`), **BR-5** (per-epoch coverage
on container re-key).

---

## 1. The problem it solves

A group rotates its epoch on removal (doc [02](./02-rotation-cas-confirmation.md)). But **containers** that
granted access to the group still have their content key `CK` wrapped to the group's **old** epoch pubkey.
Until someone re-wraps `CK` to the new epoch, a just-removed member who cached `CK` can still read **new**
container content. The bridge can't re-key (zero-knowledge), and eagerly re-keying every affected container on
every removal is wasteful. So we re-key **lazily, on the next write** to each container.

---

## 2. The algorithm

```
onWrite(container):                       # any create/append/update that produces new content
   if container.policy.forwardSecrecy != "yes": reuse current CK ; return   # FS is opt-in per container
   grantees   = container.groups          # the groups this container grants to (+ direct users)
   stale = any g in grantees where
              container.groupKeys(g).groupEpoch < currentEpochOf(g)     # g churned since CK was last wrapped
   if stale:                              # lazy/best-effort: re-key only when a grantee epoch advanced
        CK'    = freshSymKey() ; keyId' = new
        for g in grantees:
            GroupPub_now = verifiedCurrentGroupPubKey(g)                # getGroup(g) + verify (doc 01 §4)
            groupKeys'[g] = { group: g, groupEpoch: currentEpochOf(g), keyId': , data: ECIES-wrap(CK', GroupPub_now) }
        for u in directUsers:
            keys'[u] = wrap(CK', u.pubKey)
        confTag = MAC_{CK'}("confirm" || container.id || keyId')        # container-level confirmation (EP-12 analogue)
        # Re-key via the DEDICATED rotateKey method (key rotation only — cannot change members):
        submit  thread.threadRotateKey { id, keyId', keys'[...], groupKeys'[...], version, force }
        # then write the new content under CK' (a separate message/append). For containers without a
        # *RotateKey method yet (store/inbox/kvdb/stream), re-key via their *Update until they get one.
        # BR-5: bridge accepts only if each groupKeys'[g].groupEpoch == g.keyVersion (current) and coverage is exact
   else:
        reuse current CK                  # no churn → no re-key, write is cheap
```

Key properties:
- **Staleness = a cheap integer compare** (`stored groupEpoch < group.keyVersion`). `currentEpochOf(g)` comes
  from a (verified) `getGroup(g)`; cache it.
- **One re-key covers all grantee groups' latest membership at once** — wrapping `CK'` to each group's
  *current* epoch pubkey means anyone removed from *any* grantee group is excluded for free.
- **One wrap per grantee group** (a group = one wrap regardless of size) + one per direct user. Content
  encrypted once under `CK'`.
- **Old content keeps the old `CK`** — never re-encrypted. Forward secrecy applies to content written *after*
  the re-key, which is exactly the guarantee (you can't un-share the past).

---

## 3. Where it hooks in (per container module)

The re-key check sits at the **top of every write path** in each `*ApiImpl` (thread `sendMessage`/`updateThread`,
store `createFile`/`writeFile`, kvdb `setEntry`, inbox submit, stream … ). Concretely, before encrypting the
new content:
1. resolve the container's grantee groups + their current epochs (`getGroup` + verify, cached);
2. run the staleness check;
3. if stale, perform the re-key as part of the *same* write (new `keyId'`, new `groupKeys'`/`keys'`, content
   under `CK'`); else reuse `CK`.

This reuses the existing container key-generation + `EncKeyEncryptorV2` wrap; the **new** part is the
staleness check and wrapping to each group's *current verified epoch* pubkey.

---

## 4. Concurrency on the container re-key

The container key rotation is itself subject to a race (two writers re-key at once). Reuse the container's
existing optimistic-concurrency (its `keyId`/version) — and, if you want the same smooth UX as group rotation,
the bridge can return the winner's container-key envelope on a lost race (a container-level analogue of
`ROTATED_ALREADY`; optional, not required for correctness — a loser can just re-fetch and retry).

---

## 5. Eager mode (optional)

If an app wants a removed member locked out of **idle** containers' future content *immediately* (not on next
write), it can re-key eagerly on the `GroupUpdatedEvent`:
- enumerate containers the group grants into (needs a "containers a group grants into" query — a 🟡 bridge
  convenience; otherwise track app-side), and re-key each now (same write as §2, just triggered by the event).
Lazy is the default; eager is a policy choice with a cost (fan-out on every removal).

---

## 6. What this does and doesn't give
- ✅ **Forward secrecy**: removed members can't read container content written after the re-key.
- ✅ **O(grantee groups)** per re-key, not O(members) — group-as-grantee preserved.
- ❌ **Not retroactive**: content before the re-key stays readable to anyone who had `CK` then.
- ❌ **Not PCS**: a *current* member whose key leaked isn't healed by this (epochs are delivered under
  long-term member keys). See [README.md](./README.md) "Forward secrecy vs PCS".
- ⚠️ **Window**: between a removal and the next write to a given container, the removed member is
  **server-blocked** (can't fetch) but, if they cached `CK`, could still decrypt new content they somehow
  obtain out-of-band. The lazy re-key closes the cryptographic window on next write; server-revocation closes
  the access window immediately. Document this for apps that need the window minimized → use eager mode (§5).
