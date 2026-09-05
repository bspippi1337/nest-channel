# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en Android-app for betinget oppgavebehandling i små team. Arbeidsbordet viser hva som er **Klar**, hva som **Venter**, og hva som åpnes automatisk når en forutsetning blir **Ferdig**.

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

Et registrert v0.7-bygg bruker GitHubs Authorization Code-flow med:

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

GitHub Actions-workflowen leser eventuelle repo-secrets med disse navnene under APK-build.

Hvis et åpent/debug-bygg ikke har begge verdiene, faller NEST tilbake til eksisterende Device Flow med brukerlevert Client ID. Det gjør kildekoden byggbar uten at repoet later som det finnes OAuth-credentials som ikke er registrert.

## Latest-snapshot bootstrap

v0.6 leste hele historikken av NEST-kommentarer ved første GitHub-tilkobling. Det gjorde cold start tregere jo eldre kanalen ble.

v0.7 publiserer komplette krypterte snapshots med envelope-versjon 2 og bootstrapper bakfra:

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

Lokalprotokollen er bumpet til **NEST Local v3**. v2-peers blir ikke automatisk godkjent som sikre v3-peers.

### Permanent identitet

Hver installasjon får en ECDSA P-256 signeringsidentitet i Android Keystore under alias:

```text
nest_local_identity_v1
```

Privatnøkkelen er ikke eksporterbar fra Android Keystore. UI viser et SHA-256-fingeravtrykk av public key.

### Pairing

Telefon A velger **Vis pairing-QR**. QR-en inneholder en `NESTPAIR1`-invitasjon med:

- node-ID
- public identity key
- identitetsfingeravtrykk
- lokal IP
- tilfeldig 256-bit engangshemmelighet
- utløp etter fem minutter

Telefon B skanner QR-en eller limer inn koden manuelt.

Engangshemmeligheten sendes ikke rått over lokalnettet. B sender en `pair_request` med HMAC-bevis over request-data og signerer samtidig sin permanente identitet og flyktige sesjonsnøkkel. A verifiserer HMAC + ECDSA, lagrer Bs public identity og svarer med en signert `pair_accept`.

Pairing-hemmeligheten brennes etter første vellykkede request.

### Hver appstart

Ved hver lokal synkstart genererer NEST en ny flyktig ECDH P-256 keypair. Discovery-handshaken inneholder:

- permanent identity public key
- flyktig ECDH public key
- nonce
- ECDSA-signatur over handshake-data

Kun en identity key som allerede er lagret som trusted får etablere AES-256-GCM sesjonsnøkkel og motta workspace. Hvis samme node-ID plutselig presenterer en annen permanent identity key, blokkeres synk og UI varsles om identitetsendring.

Discovery-trafikk kan fortsatt observeres på LAN-et. Arbeidsdata sendes ikke til ukjente eller uverifiserte peers.

## Auto-synk

Auto kan bruke lokal verifisert P2P samtidig som GitHub holder et kryptert internettsynkspor. Samme workspace flettes med feltvise Lamport-klokker.

Manuell **Via GitHub** og **Lokalt · sikker P2P** beholdes for kontroll og feilsøking.

## Tester

`npm run check` kjører JavaScript-syntakssjekk og Node-testene.

v0.7-testene dekker blant annet:

- Klar → Venter → Ferdig-dørmodellen
- dependency-syklusdeteksjon
- samtidige feltendringer
- Lamport-sammenligning og deterministisk tie-break
- migrering fra gamle ISO-feltklokker
- ekstrem wall-clock skew uten konfliktkapring
- komplette multipart snapshots
- ignorering av ufullstendige envelopes
- fallback til siste komplette snapshot når nyere gruppe mangler chunks

GitHub Actions validerer i tillegg sikkerhetsinvariantene og bygger full Android debug-APK.

## Bygg

Krav: Java 17, Android SDK 35, Gradle 8.9 og Node.js 22+.

```bash
git clone https://github.com/bspippi1337/nest-channel.git
cd nest-channel
npm run check
cd android
gradle --no-daemon :app:assembleDebug
```

Med registrert OAuth App:

```bash
export NEST_GITHUB_CLIENT_ID='...'
export NEST_GITHUB_CLIENT_SECRET='...'
cd android
gradle --no-daemon :app:assembleDebug
```

APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Status

**v0.7.0 · Security & Sync Core**

- dørmodell: implementert
- arbeidsbord først: implementert
- Auto-synk: implementert
- GitHub E2EE: implementert
- Authorization Code + PKCE kodevei: implementert
- Device Flow fallback for uregistrerte builds: implementert
- latest-snapshot bootstrap: implementert
- Lamport-feltklokker: implementert
- Android Keystore permanent lokal identitet: implementert
- QR-verifisert `NESTPAIR1`: implementert
- signerte flyktige ECDH-sesjoner: implementert
- unknown-peer deny-by-default: implementert
- fysisk flertelefonstest av v0.7: må fortsatt verifiseres på ekte enheter
- production OAuth krever at de faktiske GitHub OAuth App-credentials legges inn som build-secrets
- APK-en er fortsatt debug-signert i dagens CI

---

**NEST Channel · BLCKSWAN**  
Riktig oppgave. Riktig person. Riktig tidspunkt.
