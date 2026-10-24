# NEST 0.9.3 Capture Edition (tutorial-only)

This isolated branch exists to capture screenshots and short screen recordings for
the NEST Channel tutorial. It starts from the experimental 0.9.3 security branch,
not from the protected mainline release.

## Capture build (debug only)

- Build via GitHub Actions on this branch, or run `cd android && gradle :app:assembleDebug`.
- App id: `no.blckswan.nestchannel.demo` (separate installation and storage).
- Android launcher name: **NEST DEMO · CAPTURE**.
- Version suffix: `-capture`.
- Only `BuildConfig.DEBUG && BuildConfig.NEST_CAPTURE_DEMO` clears
  `FLAG_SECURE`; **release always sets `FLAG_SECURE`**.
- Existing app signing key, release workflow and original
  `no.blckswan.nestchannel` app remain untouched.
- Never merge this capture variant into `main` or any production/release branch.

## Filming precautions

1. Use a disposable test device or clean simulator and **synthetic example data only**.
2. Do not enter real GitHub credentials, channel passwords, pairing QR codes, private
   keys, access tokens, chat transcripts, notification content or client names.
3. Record onboarding, task flows, chat layout, local pairing UI and About using fake
   identifiers and expired/nonfunctional invitation examples.
4. Include a visible caption: **DEMO / SYNTHETIC DATA / UNSAFE FOR REAL SECRETS**.
5. Clean the capture app's test storage after filming; do not use screenshots
   as proof of successful end-to-end communication or cryptographic review.
6. This branch inherits `SECURITY-READINESS.json` with `release_blocked: true`.
   It is not approved for high-risk real-world communication.

## Demo-only visual reference pack

The companion storyboard/screenshots can be generated from the actual HTML, CSS
and SVG assets from the exact source commit. Browser-rendered illustrations are
**not screenshots from a real Android device** and must be labeled accordingly.
