# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en Android-app for betinget oppgavebehandling i små team. I stedet for en flat to-do-liste viser appen hva som faktisk er **Klar**, hva som **Venter**, og hva som automatisk åpnes når en forutsetning blir **Ferdig**.

Versjon **0.6.0 · UX Killer** flytter fokus fra konfigurasjon til arbeid:

- arbeidsbordet vises før synkinnstillinger
- **Auto** kan kjøre sikker lokal P2P samtidig som GitHub er internettspor
- kanaldata kan deles og fylles inn med en kompakt `NEST1`-invitasjonskode
- oppgavefelt autosaves mens du skriver
- valgt avhengighet legges til direkte
- Enter sender oppgavekommentar
- ferdigmarkering viser hvilke nye oppgaver som ble klare, med **Angre**
- sletting varsler når den vil åpne ventende oppgaver, med **Angre**
- mobilvisning får tydelige **Klar / Kanal**-faner og ulest-indikator
- kompakte kontroller har større touch targets
- Android Back lukker dialog, kanalvisning eller synkpanel før appen forlates

v0.6.0 bygger videre på sikkerhets- og konfliktarbeidet fra v0.5.0.

## Dørmodellen

```text
Bestill reservedel → Monter reservedel → Test og lever
```

- **Klar:** kan gjøres nå.
- **Venter:** minst én forutsetning er ikke ferdig.
- **Ferdig:** oppgaven er fullført og kan åpne neste dør.

NEST avviser sirkulære avhengigheter og lar hver oppgave ha ansvarlig person, etiketter, kommentarer og flere vilkår.

## Arbeidsbord først

Oppgaver kan opprettes og brukes lokalt uten at synk må konfigureres først. Synkinnstillinger ligger under et kompakt **Synk og sikkerhet**-panel under arbeidsflaten.

På telefon er **Klar** den operative standardflaten. **Kanal** ligger én fane unna og viser ulest-indikator når nye meldinger kommer mens oppgavene er åpne.

## Auto-synk

v0.6.0 legger til **Auto** som anbefalt synkmodus.

I Auto:

1. lokal sikker P2P startes når Android-broen er tilgjengelig
2. GitHub kan samtidig brukes som internettsynk når GitHub-kanalen allerede er konfigurert
3. samme workspace flettes deterministisk via den eksisterende feltvise merge-modellen

Manuell **Via GitHub** og **Lokalt · sikker P2P** beholdes for kontroll og feilsøking.

## Rask invitasjon

Når en GitHub-kanal har kanalnavn og kanalpassord, kan **Inviter** lage en kompakt kode på formen:

```text
NEST1....
```

Koden inneholder repo, kanalnavn og kanalpassord og kan fylles inn via **Bli med med kode** på en annen telefon.

> En NEST1-kode er en hemmelig invitasjon fordi den inneholder kanalpassordet. Del den privat, på samme måte som du ville delt selve kanalpassordet. QR/deep-link-verifisert pairing er fortsatt et naturlig neste steg.

## Tidsbesparende oppgaveflyt

### Opprette

Hurtigskjemaet oppretter oppgaven, nullstilles og sender fokus direkte tilbake til tittelfeltet.

### Redigere

Tittel, ansvarlig og etiketter autosaves med kort debounce mens oppgaven er åpen. **Lukk** erstatter behovet for å tenke på en separat lagreoperasjon.

### Avhengigheter

Velg en oppgave under **Blir klar når**. Valget legges inn direkte hvis det ikke lager en syklus.

### Kommentarer

Enter sender kommentar direkte.

### Ferdig og nye dører

Når en oppgave markeres som ferdig, sammenligner v0.6.0 Klar-settet før og etter endringen. Hvis andre oppgaver låses opp, vises det umiddelbart:

```text
Ferdig · 2 nye oppgaver ble klare: Monter del, Test system …
```

Handlingen kan angres fra toasten.

### Trygg sletting

Hvis sletting av en forutsetning vil gjøre ventende oppgaver klare, vises konsekvensen før sletting:

```text
Slett «Bestill delen»?

Dette vil gjøre 2 oppgaver klare:
• Monter delen
• Test system
```

Sletting kan også angres etterpå.

## Via GitHub

GitHub-modus er for team som jobber på ulike nettverk eller steder. Telefonene krypterer arbeidskopien med AES-256-GCM før den publiseres som krypterte GitHub Issue-kommentarer. OAuth-token og kanalpassord lagres via Android Keystore.

Synken har:

- request-timeout
- eksponentiell retry/backoff
- jitter
- støtte for `Retry-After` og rate-limit reset
- trygg retry av mislykket publisering
- feltvis konfliktfletting

### OAuth-status

v0.6.0 fjerner ikke behovet for GitHub OAuth App-konfigurasjon. Første GitHub-oppsett bruker fortsatt Device Flow og krever en gyldig OAuth Client ID.

Å bake inn en ekte registrert appidentitet og eventuelt gå til Authorization Code + PKCE krever at NESTs GitHub OAuth App faktisk registreres med riktige callback-/appdata. Repoet hardkoder derfor ikke en oppdiktet Client ID.

## Lokalt · sikker P2P

Standard lokal flyt:

1. Koble telefonene til samme Wi-Fi eller hotspot.
2. Åpne NEST Channel.
3. Bruk **Auto** eller **Lokalt · sikker P2P**.
4. Telefonene finner hverandre automatisk.

Discovery bruker UDP multicast/broadcast. Når to NEST-telefoner finner hverandre, utveksler de midlertidige EC-public keys og etablerer en parvis ECDH-hemmelighet. Arbeidsdata komprimeres og krypteres med **AES-256-GCM** før de sendes direkte til peerens IP-adresse.

Hvis nettverket blokkerer multicast, finnes manuell IP-fallback i lokalmodus.

### Lokal sikkerhetsmodell

Lokal v0.6.0 beskytter arbeidsinnhold mot passiv avlytting på nettverket. Discovery-metadata som node-ID, enhetsnavn, IP og offentlig ECDH-nøkkel er ikke hemmelig.

Den automatiske håndhilsenen har fortsatt **ingen menneskeverifisert peer-identitet**. En aktiv angriper på samme nettverk kan derfor i teorien forsøke en man-in-the-middle-posisjon under første nøkkelutveksling. QR-/kodeverifisert nøkkelverifikasjon bør komme før lokalmodus markedsføres som menneskeverifisert pairing.

## Feltvis konflikthåndtering

Hvert redigerbart oppgavefelt har egen tidsmarkør:

- tittel
- ansvarlig
- ferdig-status
- slettet-status
- etiketter
- avhengigheter

Hvis telefon A endrer tittelen mens telefon B endrer ansvarlig, kan begge endringene overleve samme merge. Kommentarer flettes separat etter ID.

Feltklokkene bruker fortsatt ISO wall-clock-tid i v0.6.0. Hybrid Logical Clock eller Lamport-klokke er planlagt som en senere robusthetsforbedring mot enheter med skjev systemklokke.

## Tester og CI

`npm run check` kjører:

- JavaScript-syntakssjekk, inkludert `ux-v06.js`
- Node-testene i `tests/*.test.js`

Kjernetestene dekker blant annet:

- A → B → C åpnes i riktig rekkefølge
- direkte og transitive dependency-sykluser avvises
- samtidige endringer i ulike felt bevares
- kommentarer flettes uavhengig
- nyere slettemarkør kan vinne uten å overskrive en nyere tittel

GitHub Actions bygger Android-APK-en etter at sjekkene er grønne.

## Begrensninger i v0.6.0

- GitHub-synk er fortsatt polling, ikke ekte push.
- GitHub bootstrap leser fortsatt historiske sync-kommentarer; checkpoint/latest-snapshot-bootstrap er neste ytelsessteg.
- GitHub OAuth bruker fortsatt Device Flow og brukerlevert Client ID.
- `NEST1` er en delingskode, ikke QR eller menneskeverifisert kryptografisk pairing.
- lokal kontinuerlig synk krever fortsatt at appen er åpen
- klientisolasjon kan blokkere direkte UDP
- lokal peer-identitet er ikke menneskeverifisert ennå
- feltkonflikter bruker fortsatt veggklokke
- APK-en er fortsatt debug-signert

## Bygg lokalt

Krav: Java 17, Android SDK 35, Gradle 8.9 og Node.js 22+.

```bash
git clone https://github.com/bspippi1337/nest-channel.git
cd nest-channel
npm run check
cd android
gradle --no-daemon :app:assembleDebug
```

APK-en bygges til:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Prosjektstatus

**v0.6.0 · UX Killer**

- dørmodell: implementert
- arbeidsbord først: implementert
- Auto-synk: implementert
- rask NEST1-kanalinvitasjon: implementert
- autosave: implementert
- unlock-feedback + Angre: implementert
- trygg sletting + Angre: implementert
- mobil Klar/Kanal-nav: implementert
- større touch targets: implementert
- Android Back-håndtering: implementert
- GitHub E2EE: implementert
- lokal ECDH + AES-256-GCM: implementert
- feltvis konfliktfletting: implementert
- PKCE/registrert appidentitet: gjenstår
- QR-verifisert pairing: gjenstår
- latest-snapshot GitHub bootstrap: gjenstår
- logisk konfliktklokke: gjenstår
- fysisk flertelefonstest av v0.6.0: må verifiseres på ekte enheter

---

**NEST Channel · BLCKSWAN**  
Riktig oppgave. Riktig person. Riktig tidspunkt.
