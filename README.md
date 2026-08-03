# NEST Channel

**Riktig oppgave. Riktig person. Riktig tidspunkt.**

NEST Channel er en kryptert oppgaveapp for små team. Oppgaver kan vente på andre oppgaver, og blir automatisk klare når forutsetningen er ferdig.

## Internett-synk gjennom GitHub

Telefonene trenger ikke være på samme Wi-Fi. Alle installerer samme APK, logger inn med GitHub og bruker samme:

- GitHub-repo
- kanalnavn
- kanalpassord

Hver kanal representeres av en GitHub Issue identifisert med en hash. Appen publiserer ende-til-ende-krypterte arbeidskopier som Issue-kommentarer og henter nye kommentarer automatisk. GitHub lagrer og transporterer kryptert data, men har ikke kanalpassordet.

## OAuth-oppsett

Opprett en GitHub OAuth App og aktiver **Device Flow**. Ingen client secret skal bygges inn i APK-en.

1. Opprett OAuth App i GitHub Developer Settings.
2. Aktiver Device Flow.
3. Lim Client ID inn i appen.
4. Appen ber om `public_repo` og `read:user`.
5. Godkjenn enhetskoden på GitHub.

OAuth-token og kanalpassord lagres kryptert med Android Keystore på telefonen. Etter første oppsett kobler appen seg automatisk til igjen.

## Betinget oppgavebehandling

Se oppgavene som dører:

- **Klar:** Døren er åpen. Oppgaven kan gjøres nå.
- **Venter:** Døren er stengt. Appen viser hva som må bli ferdig først.
- **Ferdig:** Oppgaven lukker seg og åpner neste dør automatisk.

```text
Bestill reservedel → Monter reservedel → Test og lever
```

## Funksjoner

- «blir klar når»-vilkår
- ansvarlig person og etiketter
- oppgavekommentarer
- kryptert kanalchat
- GitHub OAuth Device Flow
- automatisk internett-synk og reconnect
- lokal offline-arbeidskopi
- pedagogisk Om-seksjon

## Bygg

```bash
git clone https://github.com/bspippi1337/nest-channel.git
cd nest-channel
npm run check
cd android
gradle --no-daemon :app:assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

GitHub Actions bygger også APK automatisk ved push til `main`.
