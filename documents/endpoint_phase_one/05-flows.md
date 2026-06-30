# 05 — How flows change (before → after)

Endpoint-centric flows for Phase 1. "EP" = endpoint, "BR" = bridge (store-only for groups), "Uk" = user key,
"Gk" = group data key, `GroupPriv`/`GroupPub` = group identity keypair, `CK` = container content key.
The bridge verifies nothing about groups — every "verify" below happens on the **endpoint**.

---

## 1. NEW flow — create a group

```mermaid
sequenceDiagram
  participant EP as Endpoint (creator)
  participant BR as Bridge (store-only)
  EP->>EP: Gk = generateKey(); (GroupPub,GroupPriv) = generateKeyPair()
  EP->>EP: membership = {users, managers, GroupPub, keyId, prevEntryHash: null}
  EP->>EP: data = GroupDataEncryptorV5.encrypt({publicMeta, privateMeta, groupPrivKey: GroupPriv, membership}, Gk, creatorPriv)  // DIO-signed
  EP->>EP: keys[] = wrap Gk to each member's Uk.pub (EncKeyEncryptorV2)
  EP->>BR: context.groupCreate { groupPubKey: GroupPub, users, managers, data, keyId, keys[] }
  BR->>BR: ACL + coverage + store (NO signature check)
  BR-->>EP: { groupId }
```

The integrity proof (author signature + member set + genesis `prevEntryHash:null`) lives inside `data`.

---

## 2. CHANGED flow — get a group (verification moved entirely client-side)

**Before (conceptual earlier design):** bridge verified the signature at write; client replayed a
`signature`/`prevSignature` chain served as bridge fields.
**After (Phase 1):** there are no bridge signature fields; the client replays the **`data` DIO chain**.

```mermaid
sequenceDiagram
  participant EP as Endpoint (member)
  participant BR as Bridge
  EP->>BR: context.groupGet { groupId }
  BR-->>EP: GroupInfo { history[], data[] (DIO blobs), users, managers, groupPubKey, version, keys }
  EP->>EP: for each version i: DIOEncryptorV1.decodeAndVerify(data[i]); check fieldChecksums
  EP->>EP: G1 chain: membership[i].prevEntryHash == sha256(data[i-1])
  EP->>EP: G2 manager-auth: signer(i) ∈ managers(i-1)   (genesis self-authorizes)
  EP->>EP: cross-check bridge history[i].users/managers == signed membership[i]
  EP->>EP: G3: UserVerifier.verify(every distinct signer)  → statusCode
  EP->>EP: decrypt my Gk (keys) → decrypt data → GroupPriv + metas
```

Any failed step ⇒ tamper/`statusCode`≠0. Full algorithm: doc [03](./03-verification.md).

---

## 3. CHANGED flow — read a group-granted container (the big change to EXISTING code)

This is the key-resolution change that touches existing thread/store/inbox/kvdb/stream read code.

**Before:** reader resolves only a direct user key entry.
```
container.keys[caller] --Uk.priv--> CK --> decrypt content
```

**After:** if the caller isn't a direct user but belongs to a grantee group, resolve through the group.
```mermaid
sequenceDiagram
  participant EP as Endpoint (group member, NOT a direct user)
  participant BR as Bridge
  EP->>BR: thread.threadGet { threadId }
  BR-->>EP: ThreadInfo { ..., groups:[{groupId,role}], groupKeys:[{group,keyId,data}] }
  Note over EP: no direct key entry for me → take the group path
  EP->>BR: context.groupGet { groupId } ; EP verifies group (doc 03)
  EP->>EP: decrypt my Gk entry (group.keys) → decrypt group.data → GroupPriv
  EP->>EP: CK = ECIES-decrypt(thread.groupKeys[groupId], GroupPriv)
  EP->>EP: decrypt + verify thread content with CK (container DIO + UserVerifier, as today)
```

If a **direct** key entry exists, the old path is taken unchanged. Resolution order + caching: doc
[04](./04-group-as-grantee.md) §3.

---

## 4. NEW flow — grant a group to a container

```mermaid
sequenceDiagram
  participant EP as Endpoint (container manager)
  participant BR as Bridge
  EP->>BR: context.groupGet { groupId } ; EP verifies group → trusted groupPubKey
  EP->>EP: groupKeys[g] = ECIES-wrap(CK) to groupPubKey (EncKeyEncryptorV2)
  EP->>BR: thread.threadCreate/Update { ..., groups:[{groupId,role}], groupKeys:[{group,keyId,data}], keys:[direct users] }
  BR->>BR: coverage: exactly the listed grantees covered for keyId → store
  BR-->>EP: OK
```

One wrap per grantee group regardless of its member count.

---

## 5. CHANGED flow — change group membership (full replace) + reconcile containers

**Before:** (earlier design) a signed delta `modifyMembers` with `prevSignature`.
**After (Phase 1):** full-replace `groupUpdate`; integrity inside `data`; membership delta is Phase 2.

```mermaid
sequenceDiagram
  participant EP as Endpoint (manager)
  participant BR as Bridge
  EP->>BR: context.groupGet { groupId } ; verify → current head hash H, current Gk/GroupPriv
  EP->>EP: newUsers = old ± change; (on removal) Gk'=new data key, (GroupPub',GroupPriv')=new identity
  EP->>EP: membership' = {newUsers, newManagers, GroupPub', keyId', prevEntryHash: H}
  EP->>EP: data' = encrypt({..., groupPrivKey: GroupPriv', membership'}, Gk', myPriv) ; keys' = wrap Gk' to remaining members
  EP->>BR: context.groupUpdate { id, groupPubKey: GroupPub', users', managers', data', keyId', keys'[], version, force:false }
  BR->>BR: version CAS + coverage + store  (no signature check)
  BR-->>EP: OK ; BR emits GroupUpdatedEvent (incl. removed members)
  Note over BR: removed member is SERVER-BLOCKED immediately
  loop for each container the group grants into (eager re-key — Phase 1)
    EP->>BR: thread/store.update { keyId'', groupKeys'' wrapped to GroupPub' , keys'' }
  end
```

- **Server revocation is immediate** (no client action).
- **Cryptographic exclusion from new container content** requires the eager re-key loop (Phase 1). Phase 2
  makes this lazy (on next write) via epochs. Doc [04](./04-group-as-grantee.md) §4.
- On `GROUP_VERSION_MISMATCH` (someone else updated first): re-`getGroup`, re-verify, rebuild against the new
  head, retry.

---

## 6. CHANGED flow — old/new clients & containers (compatibility)

| Reader \ container | direct-user only | direct **and** group | group-only |
|---|---|---|---|
| old client | works (unchanged) | works via its direct key | no access (acceptable) |
| new client | works | works (either path) | works (group path, §3) |

New endpoints must treat `groups`/`groupKeys` as **possibly absent** and fall back to the direct path — so
upgrading the endpoint never breaks reading old containers. Migration of an existing container to a group
grantee is a normal `update` adding `groups`+`groupKeys` (keep direct keys during transition = "mixed").
Details: [../plan/07-backward-compatibility-and-migration.md](../plan/07-backward-compatibility-and-migration.md).

---

## 7. Flow-by-flow: what is genuinely new code vs reused

| Flow | New endpoint code | Reused as-is |
|------|-------------------|--------------|
| create group (§1) | membership block + `GroupPriv` in `data`; `GroupDataEncryptorV5` | DIO sign, key gen/wrap (`KeyProvider`/`EncKeyEncryptorV2`) |
| get group (§2) | history replay + **G1 chain** + **G2 manager-auth** + member cross-check | DIO verify, fieldChecksums, `UserVerifier`, `statusCode` |
| read group-granted container (§3) | group key-resolution fallback (Gk→GroupPriv→CK) | container DIO/`UserVerifier`, key cache |
| grant group (§4) | wrap `CK` to a verified `groupPubKey` | `EncKeyEncryptorV2`, coverage on bridge |
| change membership + reconcile (§5) | full-replace build; eager container re-key loop | version CAS on bridge, key wrap |

The recurring theme: **integrity & identity are reused (DIO + `UserVerifier`); the new work is the membership
chain (G1/G2) and the group→`GroupPriv`→`CK` resolution.**
