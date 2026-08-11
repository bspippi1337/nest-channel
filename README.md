# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en Android-app for betinget oppgavebehandling i små team. I stedet for en flat to-do-liste viser appen hva som faktisk er **Klar**, hva som **Venter**, og hva som automatisk åpnes når en forutsetning blir **Ferdig**.

Versjon **0.5.0** gjør synken sikrere og mer robust:

- GitHub-basert E2EE-synk over internett
- sikker lokal P2P-synk med automatisk ECDH P-256 + AES-256-GCM
- nulloppsett discovery på Wi-Fi/hotspot
- valgfri manuell IP-fallback når multicast blokkeres
- eksponentiell retry/backoff med jitter og støtte for GitHub `Retry-After`
- feltvis konfliktfletting i stedet for hel-oppgave «siste skriv vinner»
- automatiske tester av dørmodellen, syklusdeteksjon og konflikthåndtering

Ingen root, Termux eller egen server er nødvendig.

## Tegneserien på ett blikk

<p align="center">
  <img src="./nest-channel-comic.webp" alt="Tegneserie som forklarer betinget oppgavebehandling og hvordan NEST Channel viser Klar, Venter og Ferdig" width="800">
</p>

## Dørmodellen

```text
Bestill reservedel → Monter reservedel → Test og lever
```

- **Klar:** kan gjøres nå.
- **Venter:** minst én forutsetning er ikke ferdig.
- **Ferdig:** oppgaven er fullført og kan åpne neste dør.

NEST avviser sirkulære avhengigheter og lar hver oppgave ha ansvarlig person, etiketter, kommentarer og flere vilkår.

## To synkveier i samme APK

### Via GitHub

GitHub-modus er for team som jobber på ulike nettverk eller steder. Telefonene krypterer arbeidskopien med AES-256-GCM før den publiseres som krypterte GitHub Issue-kommentarer. OAuth-token og kanalpassord lagres via Android Keystore.

v0.5.0 gjør GitHub-synken mer robust:

- requests har timeout
- polling bruker eksponentiell backoff etter feil
- jitter reduserer samtidige reconnect-stormer
- `Retry-After` og rate-limit reset respekteres
- en mislykket publisering markeres ikke lenger som «allerede sendt»
- midlertidige GitHub-feil sletter ikke et gyldig OAuth-token

### Lokalt · sikker P2P

Standardopplevelsen er fortsatt null oppsett:

1. Koble telefonene til samme Wi-Fi eller hotspot.
2. Åpne NEST Channel.
3. Velg **Lokalt · sikker P2P**.
4. Telefonene finner hverandre automatisk.

Discovery bruker UDP multicast/broadcast. Når to NEST-telefoner finner hverandre, utveksler de midlertidige EC-public keys og etablerer en parvis ECDH-hemmelighet. Arbeidsdata komprimeres og krypteres med **AES-256-GCM** før de sendes direkte til peerens IP-adresse.

Hvis nettverket blokkerer multicast, finnes **Avansert fallback · koble til IP manuelt**. Den endrer ikke krypteringen, den erstatter bare discovery-steget.

### Lokal sikkerhetsmodell

Lokal v0.5.0 beskytter arbeidsinnhold mot passiv avlytting på nettverket. Discovery-metadata som node-ID, enhetsnavn, IP og offentlig ECDH-nøkkel er ikke hemmelig.

Den automatiske håndhilsenen har foreløpig **ingen menneskeverifisert peer-identitet**. Det betyr at en aktiv angriper på samme nettverk i teorien kan forsøke en man-in-the-middle-posisjon under første nøkkelutveksling. QR-/kodeverifisert pairing er et naturlig neste sikkerhetssteg.

## Feltvis konflikthåndtering

Fra v0.5.0 har hvert redigerbart oppgavefelt sin egen tidsmarkør:

- tittel
- ansvarlig
- ferdig-status
- slettet-status
- etiketter
- avhengigheter

Hvis telefon A endrer tittelen mens telefon B endrer ansvarlig, kan begge endringene overleve samme merge. Kommentarer flettes separat etter ID. Eldre v0.4.x-data migreres automatisk ved å bruke oppgavens eksisterende `updatedAt` som første feltklokke.

## Hurtigstart GitHub

1. Opprett en GitHub OAuth App.
2. Aktiver **Device Flow**.
3. Lim Client ID inn i appen.
4. Logg inn.
5. Angi repo, kanalnavn, kallenavn og kanalpassord.
6. Bruk samme kanaldata på de andre telefonene.

Ingen client secret skal bygges inn i APK-en.

## Sikkerhetsoversikt

| Område | GitHub-modus | Lokalmodus v0.5.0 |
|---|---|---|
| Transport | GitHub API | Direkte UDP unicast etter discovery |
| Rekkevidde | Internett | Samme rutbare lokalnett/hotspot |
| Kryptering | AES-256-GCM | ECDH P-256 + AES-256-GCM |
| Konto | GitHub OAuth | Ingen |
| Kanalpassord | Ja | Nei |
| Discovery | GitHub repo/Issue | Multicast/broadcast eller manuell IP |
| Ekstern server | GitHub | Ingen |
| Peer-identitet | GitHub-konto + kanalpassord | Automatisk nøkkelutveksling, ikke menneskeverifisert ennå |

## Tester og CI

`npm run check` kjører både JavaScript-syntakssjekk og Node-testene i `tests/core.test.js`.

Testene dekker blant annet:

- A → B → C åpnes i riktig rekkefølge
- direkte og transitive dependency-sykluser avvises
- samtidige endringer i ulike felt bevares
- kommentarer flettes uavhengig
- nyere slettemarkør kan vinnes uten å overskrive en nyere tittel

GitHub Actions bygger Android-APK-en etter at kjernetestene er grønne.

## Begrensninger i v0.5.0

- Appen må foreløpig være åpen for kontinuerlig lokal synk.
- Klientisolasjon kan blokkere direkte UDP selv med korrekt IP.
- Lokal kryptering autentiserer ikke fysisk hvem peer-en er ennå.
- GitHub-synk er polling, ikke ekte realtime push.
- APK-en er fortsatt debug-signert.

## Bygg lokalt

Krav: Java 17, Android SDK 35, Gradle 8.9 og Node.js 22+.

```bash
git clone https://github.com/bspippi1337/nest-channel.git
cd nest-channel
npm run check
cd android
gradle --no-daemon :app:assembleDebug
```

APK-en bygges til `android/app/build/outputs/apk/debug/app-debug.apk`.

## Prosjektstatus

**v0.5.0 · Secure Local Sync + Resilient Sync**

- GitHub E2EE: implementert
- GitHub retry/backoff: implementert
- lokal ECDH + AES-256-GCM: implementert
- automatisk discovery: implementert
- manuell IP-fallback: implementert
- feltvis konfliktfletting: implementert
- kjerne-/dørmodelltester: implementert
- fysisk flertelefonstest av v0.5.0: må verifiseres på ekte enheter

---

**NEST Channel · BLCKSWAN**  
Riktig oppgave. Riktig person. Riktig tidspunkt.
