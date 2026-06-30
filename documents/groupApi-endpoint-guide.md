# Group API — privmx-endpoint (C++) implementation guide

> **⚠️ SUPERSEDED — use [endpoint_phase_one/](./endpoint_phase_one/) instead.** This early guide predates two
> decisions: (1) **GroupMembershipSignature was dropped** — the bridge verifies nothing; the membership proof
> lives in the endpoint DIO inside `data`, verified client-side (so the "signed membership log byte format /
> must match byte-for-byte" guidance below is **obsolete** — there is no bridge signature to match). (2)
> **`modifyMembers` is deferred** — membership change is full-replace `groupUpdate`. The authoritative,
> code-grounded endpoint guide is now [endpoint_phase_one/](./endpoint_phase_one/) (Phase 1) +
> [endpoint_phase_two/](./endpoint_phase_two/) (Phase 2). Keep this file only for historical context.

This is the client-side design the **privmx-endpoint** library must implement against the bridge described
in [groupApi-architecture.md](./groupApi-architecture.md). The bridge side is done; the endpoint is not.

Authoritative bridge contracts to mirror:
- ~~Signed membership log byte format: [groupMembershipSignature.md](./groupMembershipSignature.md)~~ — **OBSOLETE** (no bridge signature; integrity is in the endpoint DIO in `data`).
- RPC method/model shapes: `src/api/main/context/ContextApiTypes.ts` (group section).

---

## 1. `group::GroupApi`

Follow the C++ draft in [groupApi.md](./groupApi.md) with these adjustments:

| Endpoint method | Bridge RPC | Notes |
|---|---|---|
| `createGroup(contextId, users, managers, publicMeta, privateMeta)` | `context.groupCreate` | generates the group keypair; returns groupId |
| `updateGroup(groupId, ..., version, force)` | `context.groupUpdate` | full replace; carries `prevSignature` |
| `modifyGroupMembers(groupId, usersToAddOrUpdate, usersToRemove, managersToAddOrUpdate, managersToRemove)` | `context.groupModifyMembers` | delta; usually rotates the data key |
| `deleteGroup(groupId)` | `context.groupDelete` | rejected as `GROUP_IN_USE` if the group is still a container member |
| `getGroup(groupId)` | `context.groupGet` | returns the group + signed history; verify the chain |
| `listGroups(contextId, pagingQuery)` | `context.groupList` | |

The `data` field carries `publicMeta`/`privateMeta` encrypted exactly like a thread's data, keyed by the
group's symmetric data key (`keyId`).

---

## 2. Cryptography

**Group identity keypair.** On `createGroup`, generate an ECC keypair. The public half is `groupPubKey`
(sent in the clear, stable). The private half must be available to every member:
- encrypt the group private key to each member (or under the group's data key) and pack it into the opaque
  `data`/key blobs the bridge stores;
- on every membership change, re-encrypt/re-distribute the group private key to the new member set.

**Group data key (`keyId`).** A normal container-style symmetric key — reuse the existing endpoint
container-key machinery for the group resource itself (distribute to members via `keys: KeyEntrySet[]`).

---

## 3. Signed membership log (client is the security boundary)

On **every** create/update/modifyMembers:
1. build the canonical payload per [groupMembershipSignature.md](./groupMembershipSignature.md)
   (`sha256` of length-prefixed, sorted fields; anchored on `groupPubKey` + `prevSignature`);
2. sign it with the acting **manager's context private key** (compact 65-byte signature, Base64);
3. submit `signature` and (for update/modifyMembers) `prevSignature` = the current head entry's signature.

On **read** (`getGroup`/`listGroups`), replay the returned `history` genesis→head:
- verify each entry's `signature` against its `authorPubKey`;
- verify each `prevSignature` links to the prior entry;
- verify each signer was an authorized manager **in the state prior to that entry**;
- verify the replayed resulting member set equals the `users`/`managers` the bridge served.
Surface any failure as a tamper/error to the application.

**Shared test vectors:** generate fixed-key + fixed-payload vectors (canonical hex, sha256 hex, signature)
and assert them in CI on both repos, so a serializer divergence fails fast.

---

## 4. Group-as-grantee in container APIs

Extend the endpoint `thread`/`store`/`inbox`/`kvdb`/`stream` create/update to accept group grantees:
- add `groups` (a list of `{groupId, role: "user"|"manager"}` grants) and `groupKeys` to the create/update calls;
- when adding a group, encrypt the container key to that group's `groupPubKey` and submit it as a
  `GroupKeyEntrySet { group, keyId, data }` in `groupKeys`;
- on decrypt, a member resolves: their copy of the group private key → group private key → container key.

The bridge verifies that exactly the listed group grantees are covered for the container's `keyId`.

**Re-keying:** because the bridge can't re-encrypt container keys when a group's membership changes, a
manager/endpoint must, on the relevant group event, re-distribute affected container keys to new group
members. Design this reconciliation in the SDK.

---

## 5. Bridge error codes to handle

`GROUP_DOES_NOT_EXIST`, `GROUP_IN_USE`, `GROUP_VERSION_MISMATCH`, `INVALID_SIGNATURE`,
`DUPLICATE_RESOURCE_ID`, `ACCESS_DENIED`, `INVALID_PARAMS`, `INVALID_KEY_ID`, `USER_DOESNT_EXIST`.
