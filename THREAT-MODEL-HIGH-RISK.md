# NEST Channel: High-risk security branch
**EXPERIMENTAL SECURITY WORK. NOT CERTIFIED OR RECOMMENDED FOR WAR ZONES, JOURNALISTIC SOURCES OR TARGETED STATE ACTORS.**

This branch reduces accidental leaks without replacing NEST's legacy static shared-key cryptography. A compromised phone, exposed channel key, modified app, provider or coerced user can still reveal data. Changing a repository's visibility never undoes earlier copies.

## Implemented safeguards
- Disable screen capture and Recents thumbnails via Android FLAG_SECURE.
- Disable content/file origin access, third-party WebView cookies and remote WebView debugging; narrow external-app link handling.
- Preserve original encrypted local workspace on decryption errors and stop accidental overwrite or deletion.
- Default risk profile requires private GitHub repo, a 43-character random channel key, physical QR pairing instead of clipboard, and no direct WebRTC/STUN radio. Explicitly changing to standard beta relaxes those guards.
- The policy is an app-level risk reduction, not a cryptographic or OS-level permission boundary.

## Mandatory work before any high-risk deployment
1. Deploy independently reviewed authenticated messaging: forward secrecy, post-compromise recovery, per-device fingerprints, cryptographic anti-replay/rollback, robust rotation and member removal.
2. Stop exposing GitHub tokens and channel secrets to WebView JavaScript; implement a minimal native permissioned transport/encryption bridge and remove embedded OAuth client secrets.
3. Build a demonstrably privacy-preserving metadata and network architecture; private GitHub repos are not anonymous, and mobile network operators see location and traffic.
4. Build identity-verifying low-latency media via privacy-conscious TURN/relay-only (or remove PTT), with full threat model and on-device testing.
5. Audit all dependencies, WebView CSP/origin isolation, Android back-up/capture and device storage, supply chain, build reproducibility and release-key protection.
6. Conduct independent penetration testing (OWASP MASVS), protocol review, threat simulations and real two-device field tests, including mobile outages, compromised accounts and key revocation.
7. Document safe account recovery, forensic preservation, emergency shutdown, breach notification, accessibility and incident response before journalist or police use.
8. Keep signed v0.9.2 production on main unchanged pending independent acceptance. Preserve original signing certificate continuity.

References: https://mas.owasp.org/MASVS/ ; https://signal.org/docs/specifications/doubleratchet/

Additional narrowing: NativeBridge now rejects access to internal OAuth PKCE state/verifier keys and only exposes the specific legacy keys needed by the WebView. External intents are limited to fixed GitHub account/device paths and the assistant homepage. The `addJavascriptInterface` bridge remains a release blocker for a compromised WebView, even with CSP and navigation restrictions.
