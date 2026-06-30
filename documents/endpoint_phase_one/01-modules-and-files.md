# 01 — Modules & files to implement (C++)

Mirror the **thread** module. A group is "a container for its own lifecycle" (so its data/keys/DIO machinery
is a near-copy of thread/store) "and a member for other containers" (doc [04](./04-group-as-grantee.md)).
Paths below are under [../privmx-endpoint/endpoint/](../privmx-endpoint/endpoint/).

---

## 1. New module: `endpoint/group/`

Create a new module directory paralleling `endpoint/thread/`. Suggested layout (names mirror thread):

```
endpoint/group/
  include_pub/privmx/endpoint/group/
    GroupApi.hpp              # public façade (PIMPL), like thread::ThreadApi
    Types.hpp                 # public Group, GroupHistoryEntry, statusCode, paging types
    Events.hpp                # GroupCreatedEvent / GroupUpdatedEvent / GroupDeletedEvent
    GroupException.hpp        # group-specific exceptions (+ codes)
  include/privmx/endpoint/group/
    GroupApiImpl.hpp          # implementation (mirror ThreadApiImpl)
    ServerTypes.hpp           # JSON_STRUCT mappings for context.group* request/response
    GroupProvider.hpp         # cache + DataIntegrityStatus (mirror ContainerProvider usage)
    encryptors/group/
      GroupDataEncryptorV5.hpp        # mirror ModuleDataEncryptorV5 (+ membership block, see doc 02)
      GroupDataSchemaMapper.hpp       # mirror *DataSchemaMapper (validate + decrypt + UserVerifier)
      GroupDataSchemaStrategyV5.hpp
  src/
    GroupApi.cpp
    GroupApiImpl.cpp
    encryptors/group/
      GroupDataEncryptorV5.cpp
      GroupDataSchemaMapper.cpp
      GroupDataSchemaStrategyV5.cpp
  CMakeLists.txt              # add to the top-level build (mirror thread/CMakeLists.txt)
```

Wire it into the build the same way `endpoint/thread` is wired (top-level `CMakeLists.txt`, conan exports,
emscripten/bindings if applicable).

### `GroupApi` (public surface)
Mirror `thread::ThreadApi`. Methods (map to bridge RPCs):

| C++ method | Bridge RPC |
|------------|------------|
| `createGroup(contextId, users, managers, publicMeta, privateMeta, policies?, type?) -> groupId` | `context.groupCreate` |
| `updateGroup(groupId, users, managers, publicMeta, privateMeta, version, force, policies?) ` | `context.groupUpdate` |
| `deleteGroup(groupId)` | `context.groupDelete` |
| `getGroup(groupId) -> Group` | `context.groupGet` |
| `listGroups(contextId, pagingQuery) -> PagingList<Group>` | `context.groupList` |

`Group` (public type) exposes `groupId, contextId, groupPubKey, users, managers, publicMeta, privateMeta,
createDate, lastModificationDate, creator, lastModifier, version, statusCode` (+ optional `type`,
`policies`). Note `statusCode` — Phase 1's verification result surfaces here exactly like
`thread::Thread::statusCode` (doc [03](./03-verification.md)).

> Phase 1 has **no `modifyGroupMembers`** — `updateGroup` (full replace) is the only membership-change path.

---

## 2. `GroupApiImpl` — mirror `ThreadApiImpl`

`ThreadApiImpl` is the template ([../privmx-endpoint/endpoint/thread/src/ThreadApiImpl.cpp](../privmx-endpoint/endpoint/thread/src/ThreadApiImpl.cpp)).
Reuse the same collaborators via the `core` `Factory`/`ConnectionImpl`:
- `_keyProvider` (`core::KeyProvider`) — generate + distribute the group **data key**, build `keys[]`.
- `_serverApi` — but you need the **context.** methods; either extend the context server-api client or add a
  thin `GroupServerApi` that calls `context.groupCreate` etc. (the bridge folds groups into ContextApi, so
  the RPC strings are `context.group*`).
- `_connection.getImpl()->getUserVerifier()` — identity verification on read.
- `_eventMiddleware` / `_eventChannelManager` — subscribe + dispatch `group*` events on the `context` channel.
- `GroupProvider` — cache groups + cache `DataIntegrityStatus` (mirror how thread uses `ContainerProvider`).

Two flows to implement (detailed in doc [05](./05-flows.md)):
- **create/update** → build keys, generate/rotate the group keypair, build the group `data` (with the
  membership block + chain link, doc [02](./02-keys-and-integrity.md)), encrypt+sign via
  `GroupDataEncryptorV5`, submit.
- **get/list** → decrypt + **verify the whole history** (doc [03](./03-verification.md)).

---

## 3. `GroupDataEncryptorV5` — mirror `ModuleDataEncryptorV5`

`ModuleDataEncryptorV5` ([../privmx-endpoint/endpoint/core/src/encryptors/module/ModuleDataEncryptorV5.cpp](../privmx-endpoint/endpoint/core/src/encryptors/module/ModuleDataEncryptorV5.cpp))
encrypts `{publicMeta, privateMeta, internalMeta}` and binds them under a signed DIO with `fieldChecksums`.
`GroupDataEncryptorV5` does the same **plus** commits the group-specific fields:
- the **membership block** `{users, managers, groupPubKey, keyId, prevEntryHash}` (the G1 chain link +
  member-set commitment), and
- the **wrapped group private key** (so members holding the data key obtain `groupPrivKey`).

Both are extra fields whose SHA-256 checksums go into the DIO `fieldChecksums`, so the existing
`DIOEncryptorV1.signAndEncode/decodeAndVerify` covers them with **no change to the core DIO struct**. See doc
[02](./02-keys-and-integrity.md) for the exact field layout.

`GroupDataSchemaMapper` mirrors e.g. `StoreDataSchemaMapper`
([../privmx-endpoint/endpoint/store/src/encryptors/store/StoreDataSchemaMapper.cpp](../privmx-endpoint/endpoint/store/src/encryptors/store/StoreDataSchemaMapper.cpp)):
`validateDataIntegrity` (DIO vs server-served fields) + `validateDecryptAndConvert*` (batch decrypt → build
`UserVerifier` requests → set `statusCode`). For groups it additionally runs the **history replay + chain +
manager-authorization** checks (doc [03](./03-verification.md)).

---

## 4. Container modules gain group-grantee support (5 modules)

`thread`, `store`, `inbox`, `kvdb`, `stream` each need their `create`/`update` to accept `groups` +
`groupKeys`, and their read/decrypt path to resolve a container key wrapped to a `groupPubKey`. This is
covered in doc [04](./04-group-as-grantee.md). It is **additive** — existing direct-user flows are unchanged.

---

## 5. Server-api types (`ServerTypes.hpp`)

Add `JSON_STRUCT` mappings mirroring the bridge models in
[../plan/02-bridge-api-contract.md](../plan/02-bridge-api-contract.md) §2–§6:
`GroupCreateModel`, `GroupUpdateModel`, `GroupDeleteModel`, `GroupGetModel`, `GroupListModel`, and the
results `GroupCreateResult`, `GroupGetResult`, `GroupListResult`, with `GroupInfo` / `GroupHistoryEntryInfo` /
`GroupDataEntry`. **Do not** add `signature`/`prevSignature` — they no longer exist. The container modules'
`ServerTypes` gain `groups` + `groupKeys` on create/update and in the read shapes.

---

## 6. Events

`GroupCreatedEvent` / `GroupUpdatedEvent` / `GroupDeletedEvent` on the **`context`** channel (the bridge emits
them there). On `GroupUpdatedEvent`, **removed members are notified too** — the endpoint should drop cached
group state and, for any container the group grants into, schedule re-key reconciliation (doc
[04](./04-group-as-grantee.md) §4).

---

## 7. What you do NOT add in Phase 1
- No `modifyGroupMembers`, no epoch/`keyVersion` bookkeeping, no `generateNewGroupKey`, no `ROTATED_ALREADY`
  handling, no lazy-re-key-on-write, no ratchet/PCS. Those are Phase 2
  ([../plan/09-endpoint-issues-and-roadmap.md](../plan/09-endpoint-issues-and-roadmap.md)).
