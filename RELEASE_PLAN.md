# NEST Channel release line

This file locks the distribution milestones for NEST Channel.

## v0.9.x · Signed limited beta

- distribution: free limited distribution, maximum 20 registered devices
- package: `no.blckswan.nestchannel`
- Android: compileSdk 36, targetSdk 36
- first long-lived production app-signing identity
- GitHub release APK is signed with the NEST app-signing key
- AAB is produced from the same release commit for migration/testing
- app-signing private key is never committed to Git
- CI reads signing material only from the protected GitHub `release` environment
- signing certificate SHA-256 is emitted with each release
- v0.9.x is field/beta validation, not public Play Store production

## v1.0.0 · Google Play

- public Google Play release
- preserve package name and app-signing identity from v0.9
- enroll the v0.9 app-signing key in Google Play App Signing
- introduce a separate Play upload key for CI/AAB uploads
- build AAB for Play and signed APK for GitHub side distribution
- promote through Play testing tracks before production
- target the Play-required Android API level current at release time

## Key rule

Losing the app-signing key breaks update continuity outside Play and can complicate Play enrollment. Keep at least two encrypted offline backups. The repository must never contain `.jks`, `.keystore`, `.p12`, `.pfx`, private PEM files, passwords, or base64-encoded private signing material.

## Continuity rule for v0.9.0 → beta → public Play

**One immutable release candidate per versionCode.** The signed test APK and Play AAB must come from the same protected `release-v09.yml` GitHub Actions job and commit. Android `applicationId` remains `no.blckswan.nestchannel` and every update increments `versionCode`. Do not use CI debug APKs for upgrade testing against the v0.9.0 signed release.

For each push to `main`, the protected release job attempts to produce both signed APK and AAB, checks their certificate fingerprints against `NEST_RELEASE_CERT_SHA256`, then downloads the published **v0.9.0 signing certificate fingerprint** and checks the expected certificate against that independent baseline. Mismatch or missing secrets fails closed. Automatic pushes upload private CI artifacts but never publish a GitHub Release. Manual workflow dispatch may publish after verification.

For **Google Play**, enroll the **existing v0.9.0 app-signing key** in Play App Signing *before* distributing an app with another Play signing identity; the Google-held app-signing certificate must match v0.9.0 for seamless APK updates. Google may require separate registration of an upload key; an upload key is *not* the on-device app-signing identity. The exact same signed release AAB should first be uploaded to the Play internal or closed testing track and then promoted, **without rebuilding or changing versionCode**, to the public production track. Play's server generates delivery APKs; their certificate must match the original app-signing certificate. A new build/versionCode is required for any code changes after testing.

This repository does not claim Play Store publishing has happened. Play Console enrollment, key import and track promotion need to be verified in Play Console. No signing private keys or passwords are committed to Git.
