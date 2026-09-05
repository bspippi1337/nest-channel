# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en Android-app for betinget oppgavebehandling i små team. Arbeidsbordet viser hva som er **Klar**, hva som **Venter**, og hva som åpnes automatisk når en forutsetning blir **Ferdig**.

## v0.9.0 · Signed Limited Beta

v0.9 er den første release-linjen med en langsiktig Android app-signing-identitet.

- `applicationId`: `no.blckswan.nestchannel`
- `versionCode 11`
- `versionName 0.9.0`
- `compileSdk 36`
- `targetSdk 36`
- signert release-APK
- signert AAB fra samme release-commit
- gratis limited-distribution-mål: maksimalt 20 registrerte enheter
- v1.0 er reservert for full Google Play-publisering

Den private app-signing-keyen skal aldri committes. `tools/nest-signing-init.sh` genererer nøkkelen lokalt, lagrer den i `~/.nest-signing`, oppretter GitHub-environment `release` og sender signing-materialet til krypterte environment secrets. Release-workflowen verifiserer APK-sertifikatets SHA-256 mot den låste signeringsidentiteten før noe kan publiseres.

Se `RELEASE_PLAN.md` for den låste overgangen fra v0.9 limited beta til v1.0 Google Play.

## v0.8.0 · Zero-Setup

v0.8 flyttet GitHub-oppsettet bak en førstegangsveiviser: menneskestyrt GitHub signup/verifisering, preutfylt fine-grained-token-oppsett for åpne builds, automatisk privat repo-oppretting og automatisk kanal wiring. Lokalmodus er fortsatt tilgjengelig uten GitHub.

## v0.7.0 · Security & Sync Core

v0.7 gjør de fire arkitekturgrepene som ble stående etter UX Killer-utgaven:

- **Authorization Code + PKCE** for registrerte GitHub-bygg
- **QR-verifisert lokal pairing** før arbeidsdata får flyte over P2P
- **latest-snapshot bootstrap** i stedet for full replay av GitHub-historikk
- **Lamport-klokker** i stedet for at telefonens veggklokke avgjør feltkonflikter

v0.7 beholder arbeidsbord-først, Auto-synk, autosave, trygg sletting/Angre, unlock-feedback og mobilfanene fra v0.6.

## Dørmodellen

```text
Bestill reservedel → Monter reservedel → Test og lever
```

- **Klar:** kan gjøres nå.
- **Venter:** minst én forutsetning er ikke ferdig.
- **Ferdig:** oppgaven er fullført og kan åpne neste dør.

NEST avviser sirkulære avhengigheter og lar hver oppgave ha ansvarlig person, etiketter, kommentarer og flere vilkår.

## GitHub E2EE og PKCE

GitHub brukes bare som transport og lagring av krypterte snapshots. Kanalpassordet blir på telefonene, og workspace krypteres med AES-256-GCM før det publiseres som Issue-kommentarer.

Et registrert bygg bruker GitHubs Authorization Code-flow med:

- tilfeldig `state`
- tilfeldig PKCE `code_verifier`
- `S256` code challenge
- callback `nestchannel://oauth/callback`
- `state`-validering før code exchange
- OAuth-token lagret med Android Keystore-beskyttet `SecureStore`

GitHub krever fortsatt `client_secret` ved code exchange for OAuth Apps, også når PKCE brukes. GitHub beskriver native apper som public clients: de kan ikke holde en innbakt client secret virkelig hemmelig, og PKCE skal derfor brukes for å beskytte autorisasjonskoden. NEST bruker build-time credentials og eksponerer dem ikke til WebView-JavaScript.

### Build-time OAuth-konfigurasjon

Registrer en GitHub OAuth App med callback:

```text
nestchannel://oauth/callback
```

Sett deretter:

```text
NEST_GITHUB_CLIENT_ID
NEST_GITHUB_CLIENT_SECRET
```

Hvis et åpent/debug-bygg ikke har begge verdiene, bruker NEST den åpne Zero-Setup/token-ruten i stedet for å late som en skjult OAuth-identitet finnes.

## Latest-snapshot bootstrap

NEST publiserer komplette krypterte snapshots med envelope-versjon 2 og bootstrapper bakfra:

1. les antall kommentarer på kanal-Issue
2. start på siste side
3. grupper multipart-chunks etter envelope-ID
4. velg nyeste komplette gruppe
5. dekrypter og flett workspace
6. fortsett polling fremover fra siste observerte tidspunkt

Bootstrap leser maksimalt de siste 10 sidene à 100 kommentarer. Hvis kanalhistorikk finnes, men ingen komplett dekrypterbar snapshot finnes i dette vinduet, **nekter NEST å force-publisere lokal state over kanalen**. Det beskytter mot feil kanalpassord, ødelagt historikk og utilsiktet overskriving.

Gamle v1-envelopes kan fortsatt leses, mens nye publiseringer bruker v2 snapshots.

## Lamport-konfliktklokker

Feltkonflikter avgjøres ikke lenger av ISO-veggklokken alene.

Hvert redigerbart oppgavefelt har en logisk klokke med:

```text
counter + clientId
```

Når en lokal endring skjer, økes klientens Lamport-counter. Når remote data mottas, observeres høyeste mottatte counter før neste lokale tick.

Resultatet er at:

- telefon A kan ha helt feil dato uten å «vinne» alle konflikter
- samtidige redigeringer av forskjellige felt overlever fortsatt
- lik counter avgjøres deterministisk med `clientId`
- gamle ISO-baserte workspaces migreres deterministisk til legacy-klokker

`updatedAt` og `createdAt` beholdes som menneskelesbar metadata, men de er ikke lenger autoriteten for feltmerge.

## QR-verifisert lokal pairing

Lokalprotokollen er **NEST Local v3**.

### Permanent identitet

Hver installasjon får en ECDSA P-256 signeringsidentitet i Android Keystore under alias:

```text
nest_local_identity_v1
```

Privatnøkkelen er ikke eksporterbar fra Android Keystore. UI viser et SHA-256-fingeravtrykk av public key.

### Pairing

Telefon A velger **Vis pairing-QR**. QR-en inneholder en `NESTPAIR1`-invitasjon med node-ID, public identity key, identitetsfingeravtrykk, lokal IP, tilfeldig 256-bit engangshemmelighet og fem minutters utløp.

Telefon B skanner QR-en eller limer inn koden manuelt. Engangshemmeligheten sendes ikke rått over lokalnettet. B sender en `pair_request` med HMAC-bevis og signerer samtidig sin permanente identitet og flyktige sesjonsnøkkel. A verifiserer HMAC + ECDSA, lagrer Bs public identity og svarer med en signert `pair_accept`.

Pairing-hemmeligheten brennes etter første vellykkede request.

### Hver appstart

Ved hver lokal synkstart genererer NEST en ny flyktig ECDH P-256 keypair. Kun en identity key som allerede er trusted får etablere AES-256-GCM sesjonsnøkkel og motta workspace. Hvis samme node-ID plutselig presenterer en annen permanent identity key, blokkeres synk og UI varsles om identitetsendring.

Discovery-trafikk kan fortsatt observeres på LAN-et. Arbeidsdata sendes ikke til ukjente eller uverifiserte peers.

## Auto-synk

Auto kan bruke lokal verifisert P2P samtidig som GitHub holder et kryptert internettsynkspor. Samme workspace flettes med feltvise Lamport-klokker.

Manuell **Via GitHub** og **Lokalt · sikker P2P** beholdes for kontroll og feilsøking.

## Tester

`npm run check` kjører JavaScript-syntakssjekk og Node-testene.

Testene dekker blant annet:

- Klar → Venter → Ferdig-dørmodellen
- dependency-syklusdeteksjon
- samtidige feltendringer
- Lamport-sammenligning og deterministisk tie-break
- migrering fra gamle ISO-feltklokker
- ekstrem wall-clock skew uten konfliktkapring
- komplette multipart snapshots
- ignorering av ufullstendige envelopes
- Zero-Setup GitHub-kontrakten
- v0.9 API 36/package/signing-invariantene
- at v0.9/v1.0-milepælene forblir låst

GitHub Actions bygger en vanlig CI debug-APK uten signing-secrets. Den separate `release-v09.yml`-workflowen kan bare bygge/publisere release når det beskyttede `release`-environmentet har komplett signing-materiale og forventet sertifikatfingeravtrykk.

## Bygg

Krav: Java 17, Android SDK 36, Android Build Tools 36.0.0, AGP 8.9.1, Gradle 8.11.1 og Node.js 22+.

```bash
git clone https://github.com/bspippi1337/nest-channel.git
cd nest-channel
npm run check
cd android
gradle --no-daemon :app:assembleDebug
```

### Opprett release-signering fra Termux/Linux

Kjør én gang:

```bash
bash tools/nest-signing-init.sh
```

Scriptet:

1. genererer en RSA-4096 PKCS12 app-signing-key lokalt
2. nekter å overskrive en eksisterende nøkkel
3. eksporterer offentlig sertifikat + SHA-256 fingerprint
4. lagrer lokale credentials med stramme filrettigheter
5. bruker `gh` til å opprette GitHub-environment `release`
6. setter de nødvendige krypterte environment secrets

Etter at nøkkelbackup er kontrollert og v0.9 er på `main`:

```bash
gh workflow run release-v09.yml -R bspippi1337/nest-channel --ref main -f version=v0.9.0 -f publish=true
```

Release-workflowen bygger og verifiserer:

```text
NEST-Channel-0.9.0-release.apk
NEST-Channel-0.9.0-release.aab
NEST-Channel-0.9.0-SHA256SUMS.txt
NEST-Channel-0.9.0-cert-sha256.txt
```

## Status

**v0.9.0 · Signed Limited Beta**

- dørmodell: implementert
- arbeidsbord først: implementert
- Auto-synk: implementert
- GitHub E2EE: implementert
- Zero-Setup: implementert
- Authorization Code + PKCE kodevei: implementert for registrerte builds
- latest-snapshot bootstrap: implementert
- Lamport-feltklokker: implementert
- Android Keystore permanent lokal identitet: implementert
- QR-verifisert `NESTPAIR1`: implementert
- signerte flyktige ECDH-sesjoner: implementert
- unknown-peer deny-by-default: implementert
- API 36 buildline: implementert
- production release signing pipeline: implementert
- signing private key in Git: forbudt
- v0.9 distribution target: gratis limited beta, maks 20 enheter
- v1.0 distribution target: full Google Play
- fysisk flertelefonstest: må fortsatt verifiseres på ekte enheter
- signing secrets må provisioneres én gang med `tools/nest-signing-init.sh` før første signerte release kan publiseres

---

**NEST Channel · BLCKSWAN**  
Riktig oppgave. Riktig person. Riktig tidspunkt.
