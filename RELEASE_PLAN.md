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
