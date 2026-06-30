> # ⛔ OBSOLETE — DO NOT IMPLEMENT
> **This entire document is superseded and the design it describes was DROPPED.** Reason: we decided the
> bridge must **store group data opaquely and verify nothing** (it never verifies DIOs for any other module
> either), so the bespoke bridge-side `PMX_GROUP_SIG` signed membership log was removed. `GroupMembershipSignature.ts`
> is **deleted**; there are no `signature`/`prevSignature` bridge fields and no `GroupSignatureOp`/`GroupMembersDelta`
> types. The membership proof (author signature + member set + chain link) is now committed **inside the
> endpoint's `DataIntegrityObject` (DIO) in the group `data` blob** and verified entirely client-side, reusing
> the endpoint's existing DIO + `UserVerifier` machinery.
>
> **Current authoritative specs:** [plan/10-endpoint-security-model-and-alignment.md](./plan/10-endpoint-security-model-and-alignment.md)
> §3b (the decision + why), [endpoint_phase_one/02-keys-and-integrity.md](./endpoint_phase_one/02-keys-and-integrity.md)
> (the `membership` block + chain link in the DIO), and [endpoint_phase_one/03-verification.md](./endpoint_phase_one/03-verification.md)
> (client-side replay/verify). The content below is kept only for historical context.

---

# Group membership signature — shared contract (bridge ⇄ endpoint)  *(historical / obsolete)*

The group membership log is a chained, append-only, signed record. The **bridge is untrusted**: it stores
and serves signatures but the security boundary is the **privmx-endpoint** library verifying the chain
client-side. For that to work, both sides MUST serialize the signed payload to **identical bytes**.

The authoritative implementation is
[`src/service/cloud/GroupMembershipSignature.ts`](../src/service/cloud/GroupMembershipSignature.ts).
This document restates the contract for the C++ endpoint.

## What is signed

```
signedValue = sha256(canonical)
signature   = base64( compactEcdsa(authorPrivKey, signedValue) )   // 65 bytes: recoveryByte || r || s
```

`compactEcdsa` and the Base64 wrapping are exactly the existing PrivMX signature convention
(`ECUtils.signToCompactSignature` / `ECUtils.verifySignature2`). `authorPrivKey` is the acting manager's
**context user key**; the bridge verifies against `ContextUser.userPubKey` (stored per-entry as
`authorPubKey` so historical entries stay verifiable across key rotation).

## Canonical encoding

Concatenation of length-prefixed fields in a FIXED order. No JSON (key-order / whitespace / unicode-escape
differences across languages make JSON unsafe for byte-stable signing).

- **string field:** `uint32be(byteLength) || utf8Bytes`
- **list field:** `uint32be(count) || stringField(e0) || stringField(e1) || ...`
  with elements **sorted ascending by UTF-8 byte sequence** before encoding (so the order the caller
  supplies users/managers in is irrelevant).

The group is anchored by its **`groupPubKey`** (the client-generated cryptographic identity, known at
signing time) plus the `prevSignature` chain — NOT by the server-assigned `groupId`, which does not exist
yet when the genesis (`create`) entry is signed.

Field order:

| # | field | notes |
|---|---|---|
| 0 | `"PMX_GROUP_SIG"` | domain tag (constant) |
| 1 | `"1"` | `SIG_VERSION` (decimal string) — bump on any format change |
| 2 | `op` | `"create"` \| `"update"` \| `"modifyMembers"` |
| 3 | `contextId` | |
| 4 | `author` | userId |
| 5 | `authorPubKey` | Base58 ECC pubkey |
| 6 | `groupPubKey` | Base58 ECC pubkey — the group's stable identity / anchor |
| 7 | `keyId` | current data key id |
| 8 | `prevSignature` | `""` for the genesis (`create`) entry; else the previous entry's signature |
| 9 | `resultUsers` | list — resulting full members set the bridge enforces |
| 10 | `resultManagers` | list — resulting full managers set the bridge enforces |
| 11 | `usersAdded` | list — **only when** `op === "modifyMembers"` |
| 12 | `usersRemoved` | list — only when `modifyMembers` |
| 13 | `managersAdded` | list — only when `modifyMembers` |
| 14 | `managersRemoved` | list — only when `modifyMembers` |

For `create`/`update`, fields 11–14 are omitted entirely (not zero-length lists).

## Chain rules

- Genesis (`create`) entry: `prevSignature = ""` (null on the wire / in storage).
- Every later entry's `prevSignature` MUST equal the signature of the current head entry. The bridge rejects
  a mismatch (`GROUP_VERSION_MISMATCH`), which makes dropped/reordered deltas detectable.
- Verifier (endpoint) replays genesis → head: checks each signature against its `authorPubKey`, checks each
  `prevSignature` link, checks the signer was an authorized manager **in the state prior to that entry**, and
  checks the replayed resulting member set equals the `users`/`managers` the bridge serves. Any mismatch =
  tamper.

## Test vectors

Generate shared vectors once the endpoint signing path exists: fixed key material + fixed payloads →
expected `canonical` hex, `sha256` hex, and `signature`. Keep them in both repos and assert in CI on both
sides so a divergence in either serializer fails fast.
