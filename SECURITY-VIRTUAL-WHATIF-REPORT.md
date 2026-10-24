# NEST v5 | Virtual what-if security lab
Date: 24 October 2026
Branch: `security/095-virtual-adversarial-lab`
Draft PR: https://github.com/bspippi1337/nest-channel/pull/26

## Reproduce

```bash
npm run test:whatif
npm run check
```

Runs without a second physical Android phone. The test suite imports Node.js cryptographic primitives, implements a **reference model** of the Android local-v5 transport, and dynamically evaluates the **actual GitHub parser and reassembler** from `github-sync.js` in a restricted Node VM. Source-anchored assertions verify important Java-side security invariants but do not execute the actual Android Java code. CI also builds the Android debug APK.

The reference-model results are developer tests, **not** cryptographic certification, device attestation, or proof of safety for journalists or targeted users.

## What-if scenarios and expected results

| # | Attacker or outage | Expected virtual result | Real-device work remaining |
|---|---|---|---|
| 1 | Attacker sends a captured encrypted packet from a different Wi-Fi IP | IP of trusted peer cannot be changed by ciphertext; signed identity handshake controls address | Verify with packet capture and spoofing lab |
| 2 | Old ciphertext replayed after 1,100 newer workspace frames | Monotonic authenticated sequence rejects old frame even when LRU message-ID cache has evicted old IDs | Test UDP reorder and memory under Android |
| 3 | Attacker edits an unencrypted sequence number to a huge value | AES-GCM authentication fails because sequence is bound to AAD; counter does not advance | Instrument native receiver |
| 4 | Frames arrive out of order or some frames are dropped | Latest authenticated seq wins. Old snapshot may be discarded; fresh later periodic snapshots can repair state | Measure convergence under real packet loss |
| 5 | Adversary stores encrypted old traffic, then one peer rekeys | New traffic key / epoch differs; old ciphertext is not decrypted by current session key alone | Verify Java key erasure and replay at 15 min |
| 6 | Signed HELLO is replayed, forged or arrives outside 90-second window | Rejected by signature, timestamp freshness and per-peer accepted floor | Validate poor device clocks and offline duration |
| 7 | 250 incomplete GitHub snapshots are injected | Live pending groups capped at 8, oldest evicted | Sustained authenticated collaborator abuse remains possible |
| 8 | Valid multipart snapshot arrives in reverse/out-of-order fragments | Real GitHub reassembly reconstructs complete snapshot once | Verify transport API pagination |
| 9 | More than 200 malformed/oversized GitHub fragments arrive | Rejected without growing pending reassembly storage | Test GitHub API response limits |
| 10 | Android cannot persist a trust-reset / revocation | Local network session is stopped and no false `cleared` event emitted | Inject SharedPreferences write failures on Android |
| 11 | All virtual simulations pass | `SECURITY-READINESS.json` remains release-blocked | Independent security review required |
| 12 | App rekeys, but current workspace still contains old chat plaintext | **Expected negative outcome:** old chat remains in later snapshots; full forward secrecy is NOT present | Implement audited pair/group messaging ratchet and retention policy |
| 13 | Multipart comment declares `total:0`, `part:0`, missing or noninteger v2 counters | Rejected by actual GitHub parser | Fuzz on the device and in WebView |

## Code changes under test

- Protocol v5 is not wire-compatible with v4; both future physical test devices must run v5.
- `LocalSyncManager.java`: per-epoch outgoing sequences, authenticated monotonic incoming high-water mark, AES-GCM AAD with sender/receiver/session/sequence; signed HELLO remains authority for peer IP; synchronized receive/send/rekey; revocation failure stops local networking.
- `github-sync.js`: bounded pending encrypted chunks, oldest-only eviction, strict positive numeric v2 part/total.
- `tests/virtual-adversarial.test.js`: reproducible simulations with deterministic malformed-input seeds, real parser/reassembler execution.
- `SECURITY-READINESS.json`: unchanged with `release_blocked=true`; the release signing workflow still refuses an unsafe release.

## Explicitly unaddressed risks (must not be inferred solved)

- GitHub transport encrypts whole workspace snapshots using a static password-derived key. Rekeying ephemeral local Wi-Fi sessions does **not** protect prior encrypted GitHub history.
- Long-lived GitHub tokens and the shared channel password remain reachable by WebView JavaScript in the current app.
- Full Double Ratchet / MLS, cryptographic group member removal, ongoing post-compromise security and persistent anti-rollback for all message stores have not been implemented or independently reviewed.
- Captured encrypted packets can still be flooded to cause network availability loss. Future design should authenticate fragments before buffering and implement rate limiting.
- Lost/offline phones, compromised root/OS, tampered Android APK, cloud account compromise and traffic metadata require separate review.
- The current tests are simulated and cannot verify Android runtime permissions, chipset behavior, network drivers, clock drift, memory-wiping guarantees, or multi-device UX.
- Do not merge into signed main or claim high-risk operational readiness on the basis of CI alone.

## Suggested next round with one phone

Use the debug APK as a **single-device smoke test only**. Verify launch, About, wizard scrolling, QR UI, local address diagnostics, no unexpected permissions and that sensitive test workspaces remain encrypted. A second device is necessary to validate actual device pairing, key rotation, and reconnection.

## References

- Signal Double Ratchet: https://signal.org/docs/specifications/doubleratchet/
- IETF Messaging Layer Security RFC 9420: https://www.rfc-editor.org/rfc/rfc9420
- OWASP MASVS: https://mas.owasp.org/MASVS/
