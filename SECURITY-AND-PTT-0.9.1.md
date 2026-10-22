# NEST Channel 0.9.1 · two-phone E2EE / live PTT

Status: **experimental test build, not security-certified**. Android 16 / API 36 is the target.
The v0.9.1 branch is not a signed release until Android CI and physical two-device tests pass.

## Design: no laptop required

1. Install NEST on two Android phones. Create separate GitHub accounts directly on the phones.
2. On phone A open **Oppsett 0.9.1**, select **Telefon A** and authenticate.
3. Create an **offentlig** (default) or private repository. The repository is an **encrypted transport**, not a secure vault.
4. A creates an unpredictable 256-bit channel key and a random channel identifier. It creates the GitHub Issue automatically.
5. A displays a time-limited QR code. Its **contents are SECRET**: the invite includes the key. **Scan directly from B**. Never post the invitation to GitHub or social media.
6. On phone B select **Telefon B**, scan QR, log in to GitHub using an **independent account**, and run the authenticated encrypted read/write test.
7. In a *private* repository, A must invite B as collaborator and B must accept before the test. With a *public* repository, repo visibility does not grant GitHub write permissions through all token types. If posting fails, verify token scopes and account permissions.
8. B and A must both see the encrypted test succeed and then reopen the channel. This is a per-device self-test, not proof of delivery between devices.
9. Open **NEST LIVE · WALKIE TALKIE** on *both* phones and select **Aktiver live radio**. The microphone is muted until **HOLD INNE · SNAKK** is pressed. Release to mute.

The optional **AI-hjelp** action copies only a context description, without the GitHub token, password, channel key, or invitation, for use with ChatGPT. AI help does not get access to keys and is not required for communication.

## What GitHub does

- Holds AES-256-GCM encrypted workspace snapshots and channel control metadata.
- Holds AES-256-GCM encrypted WebRTC offer/answer signaling for PTT.
- Does **not** receive live audio. Live speech flows directly over DTLS-SRTP/WebRTC after setup.
- GitHub can see account identity, timing, traffic volume, repository membership and ciphertext in public repositories.
- GitHub can delay, delete or withhold traffic. Availability is not 99.9% guaranteed.

## What the app does

- WebView HTML and JavaScript are bundled in the Android APK.
- The WebView native credential bridge is restricted to bundled app-origin navigation. CSP disallows third-party frames/scripts.
- An Android Keystore-protected AES-GCM SecureStore encrypts channel keys and GitHub tokens at rest.
- v0.9.1 migrates workspace snapshots from plaintext WebView localStorage to native Keystore-protected storage. **Back up data** before upgrading.
- The v0.9.1 PTT uses WebRTC and the Android runtime microphone permission. It transmits only while the talk button is held.
- WebRTC uses third-party STUN services to attempt NAT traversal. IP-related metadata is disclosed to the STUN providers and the other peer. **No TURN relay is configured**, so restrictive networks may fail.
- WebRTC can go offline when Android pauses or kills the WebView. **Foreground-only PTT** is the supported beta mode.

## Security limitations / release blockers

- **Unaudited protocol.** No public independent cryptographic audit. No honest claim of "vanntett" or "99.9% ufeilbarlig".
- **Endpoint compromise.** Excluding a laptop does not protect a compromised Android phone or modified APK.
- **No post-compromise history protection.** NEST's static shared AES channel key unlocks recorded GitHub history if later exposed. Rotation and per-message forward secrecy are NOT yet implemented.
- **Internet identity.** QR transfer authenticates *possession of a shared secret*, not verified per-device identities for GitHub. The verified local NESTPAIR1 P2P identity protocol is separate.
- **Open invite secrecy.** A QR screenshot or an invitation shared on an untrusted service exposes the channel key. Expiration is enforced by the wizard, but an attacker who copied the key can still decrypt history after expiration. Use direct scanning.
- **Sync replay / rollback.** GitHub may replay, omit or roll back snapshots. The existing Lamport field clocks are not a cryptographic anti-rollback ledger.
- **Public repo metadata** is visible. Repo name, issue existence and message timing reveal that a channel exists.
- **DoS / availability.** GitHub API rate limits and outages can interrupt setup and sync, as can WebRTC NAT restrictions.
- **No guarantee of background radio.** The current WebView PTT is not an Android foreground service. It is for live, unlocked use.
- **No TURN fallback or offline queue** for real-time speech. The voice channel can fail across carrier-grade NAT.
- **Token scope.** OAuth broad repo scopes and legacy PATs can expose more repositories than intended. Prefer fine-grained tokens where functional and never share tokens.
- **No sender-side stop guarantee** if a peer intentionally modifies code; shared-key members can impersonate channel control messages.

## Physical acceptance checklist

- [ ] Android CI builds with Java 17, Gradle 8.11.1, API 36, no compile errors.
- [ ] Existing v0.9 workspace upgrades without data loss, and the plaintext copy is removed.
- [ ] New install: A creates public repo; B independently logs in and posts/readbacks ciphertext.
- [ ] Repeat with a private repo and explicit invitation acceptance.
- [ ] QR invitation expiration, corrupted invite and wrong channel key fail safely.
- [ ] A and B can both send/receive workspace/chat with their own accounts.
- [ ] Both enable PTT; each grants microphone permission via Android.
- [ ] Press and hold sends low-latency speech, release mutes, denied permission sends nothing.
- [ ] Simultaneous presses are handled; background/lock behavior is shown as unsupported.
- [ ] Test same Wi-Fi, different Wi-Fi, LTE/5G, mobile hotspot, and carrier-grade NAT.
- [ ] GitHub 403/429 and offline are handled without losing the local workspace.
- [ ] Release APK is signed by the existing v0.9 app signing identity, not a new key.
- [ ] Independent security review before claiming high-assurance confidentiality.

NEST 0.9.1 is **experimental** until these checks pass. Signing secrets must not be in GitHub source or chats.
