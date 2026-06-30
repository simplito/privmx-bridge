# 04 — Group-as-grantee in container modules (thread/store/inbox/kvdb/stream)

The second half of "groups work": a container can grant access to a **group** by wrapping its content key to
the group's `groupPubKey`. A member then reads the container by resolving *their group data-key → group
`data` → `GroupPriv` → container key*. This is **additive** to every container module — existing direct-user
flows are untouched.

The bridge already accepts and stores `groups` + `groupKeys` on all 5 containers and enforces set-equality
coverage. The endpoint work is: send them on create/update, and resolve them on read.

---

## 1. Container content key wrapped to a group

A container's content key `CK` (the existing per-container `EncKey`) is, in addition to being wrapped to each
direct user, **wrapped once to each grantee group's `groupPubKey`**:

```
groupKeys[g] = ECIES-wrap(CK) to g.groupPubKey, signed by author (a DIO-bearing entry, like a user key entry)
             → submitted as GroupKeyEntrySet { group: g.groupId, keyId: CK.keyId, data }
```

Use the **same `EncKeyEncryptorV2` path** as a user key entry — the only difference is the **recipient public
key is a group's `groupPubKey`** instead of a user pubkey. One wrap per grantee group, regardless of the
group's size (that's the whole point of group-as-grantee).

> Resolve `groupPubKey` only from a **verified** group (doc [03](./03-verification.md), G4): call
> `getGroup(g)`, verify its history, then use the verified `groupPubKey`. Never wrap to a `groupPubKey` taken
> unverified from the container record.

---

## 2. Create / update a container with a group grantee

Extend each module's `create`/`update` (e.g. `ThreadApiImpl::createThread`/`updateThread`) to accept:
- `groups: [{ groupId, role }]` (role = `"user" | "manager"`), and
- `groupKeys: [{ group, keyId, data }]` (the `CK`-to-`groupPubKey` wraps).

Steps (thread create shown; identical shape for store/inbox/kvdb/stream):
1. Generate/choose `CK` (`keyId`) as today.
2. Wrap `CK` to each direct user → `keys[]` (as today).
3. For each grantee group `g`: `getGroup(g)` (+verify) → wrap `CK` to `g.groupPubKey` → `groupKeys[]`.
4. Submit create/update with both `keys` and `groupKeys`, and the `groups` grant list.

The bridge's coverage check requires **exactly** one `groupKeys` entry per listed grantee group for the
container's `keyId` (no missing → anti-ghosting; no extra → no stray access). Mismatch ⇒ `INVALID_PARAMS`.

---

## 3. Reading a group-granted container (the key-resolution change)

The decrypt path gains one level of indirection. On `getThread`/`getMessage`/etc., to obtain `CK`:

```
resolveCK(container, caller):
  # 1) direct path (unchanged)
  if container.keys has an entry for caller:
     return KeyProvider.decrypt(entry, caller.userPriv)         # existing flow

  # 2) group path (NEW)
  for g in container.groups where caller ∈ membersOf(g):        # membership from verified getGroup(g)
     Gk      = decrypt my data-key entry of g                   # from g.keys (KeyProvider)
     GroupPriv = decrypt(g.data, Gk).groupPrivKey               # group identity secret (doc 02)
     gke     = container.groupKeys[g.groupId] for this keyId
     return ECIES-decrypt(gke.data, using GroupPriv)            # CK
```

Then decrypt + verify container content as today (the container's own DIO + `UserVerifier`). Cache `Gk`,
`GroupPriv`, and `CK` per the existing key cache.

This resolution is the single most important change to **existing** read code — see doc [05](./05-flows.md) §3
for the before/after.

---

## 4. Re-key reconciliation when group membership changes (Phase 1)

The bridge **cannot** re-encrypt container keys when a group's membership changes (it's zero-knowledge). Two
layers:

- **Server-enforced revocation (immediate, automatic):** the bridge stops serving group-granted containers to
  a removed member as soon as the `groupUpdate` commits. No endpoint action needed for this.
- **Cryptographic exclusion from *future* container content (endpoint's job):** because a removed member may
  have cached `GroupPriv`/`CK`, you must **re-key** affected containers to lock them out of new content.

**Phase 1 reconciliation = eager full re-key.** On a `GroupUpdatedEvent` that removed members (or rotated the
group identity), a manager client:
1. enumerates the containers that grant to this group (Phase 1: track these app-side, or scan the user's
   containers; a bridge "containers a group grants into" query is a 🟡 Phase-2 convenience),
2. for each, performs a normal container `update` that rotates `CK` (`keyId'`) and re-wraps it to the group's
   **new** `groupPubKey` (+ direct users),
3. submits one container update each.

> Phase 2 replaces this with **lazy re-key on write** + epochs (no eager fan-out; re-key happens on the next
> write, staleness detected via `groupEpoch`). Phase 1 deliberately keeps it simple: server-revocation is
> immediate; cryptographic FS of container content depends on the manager running the eager re-key. Document
> this limitation to app developers.

---

## 5. Per-module checklist (apply to all 5)

For `thread`, `store`, `inbox`, `kvdb`, `stream`:
- [ ] `*ApiImpl::create*` / `update*` accept `groups` + `groupKeys`; wrap `CK` to each grantee `groupPubKey`.
- [ ] `ServerTypes` create/update models + read shapes gain `groups` / `groupKeys` (optional on input).
- [ ] Read/decrypt path implements the §3 group key-resolution fallback.
- [ ] Treat `groups`/`groupKeys` as **possibly absent** on read (old containers / old peers) → behave exactly
      as today (direct-user keys only). (Backward-compat — [../plan/07-backward-compatibility-and-migration.md](../plan/07-backward-compatibility-and-migration.md).)
- [ ] Public `Container` types may expose the grant list (`groups`) for UI; key material stays internal.

No change to the container's own DIO/`UserVerifier` logic — only the **key acquisition** step gains the group
fallback.
