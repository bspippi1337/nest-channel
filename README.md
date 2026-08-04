# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en Android-app for betinget oppgavebehandling i små team. I stedet for å vise en flat liste over alt som må gjøres, viser appen hva som faktisk kan gjøres nå, hva som venter, og hvilken oppgave som åpnes når et vilkår er fullført.

Versjon **0.4.0** samler to synkmetoder i samme APK:

- **Via GitHub** for kryptert samarbeid over internett
- **Lokalt · null oppsett** for direkte synk på samme Wi-Fi eller hotspot

Ingen root, Termux eller egen server er nødvendig.

## Tegneserien på ett blikk

<p align="center">
  <img src="./nest-channel-comic.webp" alt="Tegneserie som forklarer betinget oppgavebehandling og hvordan NEST Channel viser Klar, Venter og Ferdig" width="800">
</p>

Tegneserien viser problemet med en flat oppgaveliste, dørmodellen bak betinget oppgavebehandling og hvordan NEST Channel automatisk gjør neste riktige oppgave klar.

## Hvorfor NEST

Tradisjonelle oppgavelister forteller hva som skal gjøres. NEST forteller når det gir mening å gjøre det.

```text
Bestill reservedel → Monter reservedel → Test og lever
```

Når den første oppgaven markeres som ferdig, blir den neste automatisk klar. Teamet slipper statusrunder, dobbeltarbeid og spørsmålet «kan jeg begynne nå?».

## To synkveier i samme app

### 1. Via GitHub

GitHub-modus er laget for team som arbeider på forskjellige nettverk eller steder.

Alle bruker samme:

- GitHub-repo
- kanalnavn
- kanalpassord

Appen oppretter eller finner en kanal representert av en GitHub Issue. Arbeidskopier krypteres på telefonen før de publiseres som Issue-kommentarer. GitHub transporterer og lagrer kryptert data, men har ikke kanalpassordet.

**GitHub-modus gir:**

- synk over mobilnett og internett
- ende-til-ende-kryptert kanalinnhold
- GitHub OAuth Device Flow
- automatisk polling og reconnect
- lokal offline-arbeidskopi
- sikkert lagret OAuth-token og kanalpassord via Android Keystore

### 2. Lokalt · null oppsett

Lokalmodus er laget for rask bruk i samme rom, verksted, bil, arrangement eller midlertidige team.

Åpne appen på telefonene, velg **Lokalt · null oppsett**, og la dem være på samme Wi-Fi eller hotspot. Appene finner hverandre automatisk med multicast og broadcast.

Ingen av disse feltene er nødvendige:

- konto
- kanal
- passord
- IP-adresse
- vert eller klient

Oppgaver, kommentarer og kanaldata sendes direkte mellom telefonene. Data går ikke via GitHub eller en ekstern skytjeneste.

> Lokalmodus bruker foreløpig ikke applikasjonskryptering. Bruk derfor et lokalt nettverk eller hotspot du stoler på.

## Betinget oppgavebehandling

Se oppgavene som dører:

- **Klar:** Døren er åpen. Oppgaven kan gjøres nå.
- **Venter:** Døren er stengt. Appen viser hva som må bli ferdig først.
- **Ferdig:** Oppgaven lukker seg og åpner neste dør automatisk.

NEST hindrer sirkulære avhengigheter og lar hver oppgave ha ansvarlig person, etiketter, kommentarer og én eller flere forutsetninger.

## Funksjoner

- «blir klar når»-vilkår
- automatisk status som Klar, Venter eller Ferdig
- ansvarlig person og etiketter
- oppgavekommentarer
- kanalchat
- søk og filtrering
- GitHub-basert E2EE-internettsynk
- lokal nullkonfigurasjonssynk
- automatisk oppdagelse på Wi-Fi og hotspot
- lokal offline-arbeidskopi
- Android Keystore for hemmeligheter
- pedagogisk Om-seksjon med arbeidsflyteksempel og tegneserie
- én APK for begge synkmoduser

## Hurtigstart

### Lokal bruk

1. Installer samme APK på telefonene.
2. Koble telefonene til samme Wi-Fi, eller la dem bruke samme hotspot.
3. Åpne NEST Channel.
4. Velg **Lokalt · null oppsett**.
5. Vent til appen viser at andre NEST-telefoner er funnet.
6. Opprett eller endre en oppgave. Endringen synkroniseres direkte.

### GitHub-bruk

1. Opprett en GitHub OAuth App.
2. Aktiver **Device Flow**.
3. Lim Client ID inn i appen.
4. Logg inn med GitHub.
5. Angi repo, kanalnavn, kallenavn og kanalpassord.
6. Bruk samme kanaldata på de andre telefonene.

Ingen client secret skal bygges inn i APK-en.

## Sikkerhetsmodell

| Område | GitHub-modus | Lokalmodus |
|---|---|---|
| Transport | GitHub API | UDP multicast og broadcast |
| Rekkevidde | Internett | Samme Wi-Fi eller hotspot |
| Konto | GitHub OAuth | Ingen |
| Kanalpassord | Ja | Nei |
| Applikasjonskryptering | AES-256-GCM | Ikke ennå |
| Hemmelighetslagring | Android Keystore | Ingen hemmeligheter nødvendig |
| Ekstern server | GitHub | Ingen |

GitHub kan se metadata som Issue, tidspunkt og krypterte kommentarer, men ikke det dekrypterte arbeidsinnholdet. I lokalmodus sendes arbeidskopien bare på lokalnettet, men andre enheter på samme nett kan i prinsippet observere trafikken.

## Arkitektur

```text
┌──────────────────── NEST Channel APK ────────────────────┐
│                                                         │
│  Betinget oppgavemotor                                  │
│  ├─ oppgaver, vilkår, ansvarlige og etiketter           │
│  ├─ kommentarer og kanalchat                            │
│  └─ lokal arbeidskopi i WebView-lagring                 │
│                                                         │
│  Synkvalg                                               │
│  ├─ GitHub: OAuth → kryptering → Issue-kommentarer      │
│  └─ Lokalt: automatisk peer discovery → direkte UDP     │
│                                                         │
│  Android-bro                                            │
│  ├─ Keystore                                            │
│  ├─ OAuth Device Flow                                   │
│  └─ LocalSyncManager                                    │
└─────────────────────────────────────────────────────────┘
```

## Begrensninger i v0.4.0

- Lokalmodus krever samme Wi-Fi eller hotspot.
- Enkelte bedriftsnett og gjestenett blokkerer multicast eller isolerer klienter.
- Appen må foreløpig være åpen for kontinuerlig lokal synk.
- Lokalmodus har ingen applikasjonskryptering eller tilgangskontroll ennå.
- Konflikter løses ved å slå sammen oppgaver og velge den nyeste oppdateringen per element.
- APK-en er debug-signert og er ikke Play Store-signert.

## Bygg lokalt

Krav:

- Java 17
- Android SDK 35
- Gradle 8.9
- Node.js for JavaScript-sjekken

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

GitHub Actions validerer JavaScript og bygger APK automatisk ved push og pull requests.

## Prosjektstatus

**v0.4.0 · Dual Sync**

- GitHub-basert E2EE-synk: implementert
- lokal nullkonfigurasjonssynk: implementert
- modusvelger i samme APK: implementert
- Android CI-bygg: grønt
- fysisk test mellom flere telefonmodeller: pågår
- bakgrunnssynk og kryptert lokalmodus: neste naturlige utviklingssteg

---

**NEST Channel · BLCKSWAN**  
Riktig oppgave. Riktig person. Riktig tidspunkt.
