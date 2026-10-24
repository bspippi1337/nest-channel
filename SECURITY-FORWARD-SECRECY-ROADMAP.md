# NEST 0.9.4 security roadmap: what can actually be claimed

Status: experimental, October 24, 2026. This document is a security engineering plan and a record of code observations, **not** an independent audit or cryptographic guarantee.

## Definitions and security claims

- **Transport-session separation:** When a new authenticated ephemeral ECDH key is established and old traffic keys are no longer accessible, disclosure of the current session key alone does not decrypt *previous session network captures*. This assumes old private and traffic keys were actually erased from memory and never backed up. Java GC cannot prove perfect erasure.
- **Message forward secrecy:** Later compromise of a device's current *cryptographic state* should not recover old encrypted message ciphertext when historical message keys were erased. The plaintext already retained on the phone may still be read if the endpoint is compromised.
- **Post-compromise security:** After a compromise has ended and a fresh authenticated DH ratchet completes, new messages become secret again. NEST does **not** provide this now.
- **Group membership security:** After removing a member, new messages must use keys they cannot derive. Current shared GitHub channel passwords cannot offer such exclusion.
- **Metadata privacy:** Encryption of content is not anonymization. GitHub and network operators still observe account, repository activity, timing and IP information.

## Shipped on the experiment branch

1. Android local protocol v4 uses an EC P-256 ephemeral key pair, authenticated by its device's Android Keystore P-256 identity. Signed HELLO binds the public key and timestamp.
2. Automatic rotation is scheduled every 15 minutes while local sync is running. The current ephemeral session and per-peer traffic keys are replaced; revoked peers also cause a rotation.
3. Traffic key derivation uses ECDH and HKDF-HMAC-SHA256, binding the ordered node IDs and both public session keys. AES-256-GCM authenticates the session epoch in additional authenticated data.
4. Wrong-epoch traffic and duplicate authenticated packet IDs are rejected; signed HELLO timestamps must fall within a 90-second clock window, and per-peer accepted epoch floors are stored on-device.
5. Limits are enforced on fragment count, active assemblies, decompressed workspace size, pending GitHub multipart groups, and base64 envelope shape/size.
6. GitHub channel key persistence no longer silently ignores Android SecureStore write failures; failed connection cleanup disables sending.
7. Security release readiness remains blocked. The signed main version is unchanged.

## Blocking flaws that require a protocol migration

### P0-1. Static GitHub channel root secret

`app.js prepareRoom` derives one AES-256-GCM key via PBKDF2 from a channel password. `github-sync.js` encrypts the entire workspace snapshot under that key for every upload. This design provides **no forward secrecy** for GitHub history. Password rotation that keeps an earlier root accessible does not solve this.

**Acceptance:** Replace static shared-key snapshots for communication with independently reviewed per-device authenticated messaging (Signal Double Ratchet for pairs, or MLS for properly designed groups). New messages must be encrypted under fresh message keys with specified deletion and skipped-message limits.

### P0-2. Workspace stores old plaintext

The workspace includes previous chat and task history. Even if an old *wire key* cannot be derived from a new key, a compromised current endpoint can read saved plaintext. Define message retention, expiration, secure deletion limits, encrypted backup policy and recovery UX. Never describe this as perfect erasure on flash storage.

### P0-3. Cryptographic sender identity and membership

The GitHub snapshot sender attribution is not cryptographically authenticated. Any authorized holder of a shared channel secret can author an indistinguishable snapshot. Implement per-device identity keys verified out-of-band; authenticated membership add/remove; epoch commits; and a recovery flow for lost or replaced phones. Do not use only a display nickname as identity.

### P0-4. Replay, rollback and fork attacks

The static GitHub envelope does not authenticate author, causal order, snapshot epoch or immutable GitHub comment ID. Reposting an old but valid ciphertext may pass decryption. Implement authenticated message sequence numbers, device-scoped counters, commit hashes, fork/rollback warnings and cryptographically verifiable membership epochs, with crash-safe persisted high-water marks.

### P0-5. WebView trust boundary and OAuth credential handling

The Android JS bridge still exposes the GitHub bearer token and channel password to WebView JavaScript. An embedded OAuth client secret in an APK is not a real secret. Move token-bearing networking and key processing into a narrowly permissioned native service; audit OAuth public-client/PKCE flow and request the least GitHub permissions practical.

### P0-6. Transport and identity metadata

Private GitHub repositories reveal traffic patterns and account identities to GitHub. Local Wi-Fi discovery exposes presence. Direct STUN/WebRTC can expose IP addresses when enabled in standard mode. Explicitly model the actual threat actors before claiming metadata protection.

## Proposed migration steps

1. Select an audited, maintained cryptographic protocol/library and an identity trust model. Avoid a custom "rolling password" protocol as the primary channel security mechanism.
2. Implement per-device identity provisioning and QR fingerprint verification, with secure keystore lifecycle and recovery plan.
3. Separate chat history from current workspace snapshots. Use encrypted per-message envelopes, bounded skipped-message storage, authenticated group epochs and backward-compatible read-only migration where possible.
4. Define offline behavior: handling concurrent members, interrupted epoch commits, missed messages, account suspension and message replay.
5. Migrate to native-only key and token handling; allow WebView only constrained operations that do not return raw secrets.
6. Build a dual-protocol experimental track with explicit migration and safety gates. Never silently import an old static key into a ratchet and claim history is safe.
7. Test using two actual Android devices: initial pairing, 15-minute forced rotation, losing/recovering Wi-Fi, clock skew, key compromise simulation, reorder/loss/replay and ex-member removal.
8. Commission independent protocol review and mobile penetration test before any high-risk deployment or production merge.

## Cross-version compatibility

Local v4 packets cannot interoperate with local v3 packets. Run the same experimental build on BOTH devices. The GitHub channel remains on the legacy envelope format; the local-session change does not re-encrypt or rotate existing GitHub history.

## References
- Signal Double Ratchet: https://signal.org/docs/specifications/doubleratchet/
- Signal X3DH: https://signal.org/docs/specifications/x3dh/
- IETF MLS: https://www.rfc-editor.org/rfc/rfc9420
- OWASP MASVS: https://mas.owasp.org/MASVS/

## Verification record

- GitHub PR: https://github.com/bspippi1337/nest-channel/pull/25 (draft, unmerged)
- Build CI: see latest head checks in PR. `npm run check` executes Node tests. Android GitHub Action compiles debug APK.
- Code review independent of authors, real-device tests, production signing and Play distribution **not** completed. Leave `SECURITY-READINESS.json` blocked.

## Additional adversarial hardening: local v5 and repeatable virtual tests

- Local protocol v5 authenticates an increasing 64-bit `seq` in AES-GCM additional data for each workspace envelope, in addition to the ephemeral ECDH epoch. Old or out-of-order complete snapshots are rejected after a newer authenticated sequence has been accepted. Reordering is handled fail-closed for outdated snapshots; scheduled workspace retransmission eventually delivers current state if the network recovers.
- A ciphertext header can no longer change a paired device's IP routing: the peer's address is accepted only after an identity-authenticated HELLO or pairing exchange. A replayed valid ciphertext from a different IP therefore cannot redirect outbound traffic.
- Local receiver, key rotation and sender encryption are mutually synchronized to prevent key-epoch mixups while fragments are emitted; this may reduce throughput during large workspace transfers.
- Revocation failure now stops local networking and refuses the misleading "cleared" success event. Successful revocation also clears cached manual IP targets.
- Untrusted GitHub multipart pressure now evicts one oldest incomplete group rather than discarding every in-progress group. Legitimate delivery is still vulnerable to sustained flooding by a GitHub writer; authenticated transport envelopes and sender authorization remain P0.
- v5 cannot talk to v4 or v3. Both physical test devices must run the same experimental version. Virtual tests cover cryptographic replay, reordering, drop/retry, false-source poison attempts and simulated revocation. These are NOT physical-device or independent-review evidence.

## Experimental v6 symmetric per-message ratchet (October 2026)

- An authenticated P-256 ephemeral local session establishes a root secret and two *directionally distinct* HMAC-SHA256 sending/receiving chains. A fresh encryption key is derived for each workspace transport envelope. The previous chain state and per-message key byte buffers are overwritten at the application layer on successful processing; the old 15-minute ECDH epoch still rolls independently.
- Receiver advances at most 128 missing sequence numbers on a **temporary** ratchet copy and installs the advanced chain *only after* AES-256-GCM authentication and decompression succeed. Replays and forged packets cannot advance state. Lost intermediate snapshots are intentionally abandoned; periodic retransmission of current workspace can recover functionality.
- The v6 chain changes protection of local **network ciphertext**, not the historical *plaintext* resent inside each workspace. Current code still stores decrypted old chats in Android SecureStore and includes them in future transmissions.
- In strict high-threat profile, the legacy GitHub and full-workspace local transport are blocked, including GitHub wizard test uploads. Standard beta retains the old paths exclusively for benign functional tests. Native Android bridge independently rejects local historical workspace transport while strict.
- Before usable full end-to-end forward secrecy, migrate GitHub from whole-workspace snapshots to authenticated, independently reviewed Double Ratchet (pair) or MLS (group) per-message encrypted envelopes, define one identity key per device and QR fingerprint verification, crash-safe one-way key advancement, offline skipped-message limits, deletion/retention semantics and group removal without old key access. All must pass two-device tests and independent cryptographic review.
- libsignal is a candidate for pair messaging, but its maintainers explicitly state third-party use is unsupported and its AGPLv3 license must be evaluated. MLS RFC 9420 is the open group standard. NEST does not yet have a validated third-party library integrated.

Sources: https://signal.org/docs/specifications/doubleratchet/ ; https://www.rfc-editor.org/rfc/rfc9420 ; https://github.com/signalapp/libsignal
