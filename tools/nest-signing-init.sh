#!/usr/bin/env bash
set -euo pipefail

REPO="${NEST_REPO:-bspippi1337/nest-channel}"
ENVIRONMENT="${NEST_RELEASE_ENVIRONMENT:-release}"
ALIAS="${NEST_RELEASE_KEY_ALIAS:-nest-app-signing-v1}"
KEY_DIR="${NEST_SIGNING_DIR:-$HOME/.nest-signing}"
KEYSTORE="$KEY_DIR/nest-app-signing-v1.p12"
CERT="$KEY_DIR/nest-app-signing-v1-cert.pem"
CREDENTIALS="$KEY_DIR/KEEP-OFFLINE.txt"

say() { printf '\n[NEST 0.9] %s\n' "$*"; }
fail() { printf '\n[NEST 0.9] ERROR: %s\n' "$*" >&2; exit 1; }

install_termux_deps() {
  command -v pkg >/dev/null 2>&1 || return 0
  local packages=()
  command -v gh >/dev/null 2>&1 || packages+=(gh)
  command -v openssl >/dev/null 2>&1 || packages+=(openssl-tool)
  command -v base64 >/dev/null 2>&1 || packages+=(coreutils)
  if [ "${#packages[@]}" -gt 0 ]; then
    say "Installerer Termux-avhengigheter: ${packages[*]}"
    pkg install -y "${packages[@]}"
  fi
}

install_termux_deps
command -v gh >/dev/null 2>&1 || fail "GitHub CLI (gh) mangler."
command -v openssl >/dev/null 2>&1 || fail "OpenSSL CLI mangler (Termux-pakken heter openssl-tool)."
command -v base64 >/dev/null 2>&1 || fail "base64 mangler."

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [ -e "$KEYSTORE" ]; then
  fail "Nøkkelen finnes allerede: $KEYSTORE. Nekter å overskrive app-identiteten."
fi

PASSWORD="$(openssl rand -hex 32)"
PRIVATE_KEY="$KEY_DIR/nest-app-signing-v1-key.pem"

say "Genererer langsiktig NEST app-signing key lokalt"
openssl req -x509 -newkey rsa:4096 -sha256 -nodes \
  -keyout "$PRIVATE_KEY" \
  -out "$CERT" \
  -days 10000 \
  -subj "/C=NO/O=BLCKSWAN/OU=Release/CN=NEST Channel"
chmod 600 "$PRIVATE_KEY"
chmod 644 "$CERT"

openssl pkcs12 -export \
  -inkey "$PRIVATE_KEY" \
  -in "$CERT" \
  -name "$ALIAS" \
  -out "$KEYSTORE" \
  -passout "pass:$PASSWORD"
chmod 600 "$KEYSTORE"
rm -f "$PRIVATE_KEY"

FINGERPRINT="$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 | sed 's/^sha256 Fingerprint=//I')"
[ -n "$FINGERPRINT" ] || fail "Kunne ikke lese SHA-256-fingeravtrykket."

umask 077
cat > "$CREDENTIALS" <<EOF
NEST Channel app-signing identity v1

Repository: $REPO
Alias: $ALIAS
PKCS12 password: $PASSWORD
SHA-256 certificate fingerprint: $FINGERPRINT

KEEP THIS FILE OFFLINE WITH THE PKCS12 FILE.
Never commit either file to Git.
The same app-signing identity is reserved for v0.9.x and v1.0.x update continuity.
EOF
chmod 600 "$CREDENTIALS"

say "Lokal nøkkel er klar"
printf 'Keystore: %s\nCertificate: %s\nCredentials: %s\nSHA-256: %s\n' "$KEYSTORE" "$CERT" "$CREDENTIALS" "$FINGERPRINT"

if ! gh auth status -h github.com >/dev/null 2>&1; then
  say "GitHub trenger ett menneskesteg. Nettleseren åpnes for innlogging."
  gh auth login -h github.com -p https -w
fi

gh auth status -h github.com >/dev/null 2>&1 || fail "GitHub-innlogging ble ikke fullført."

say "Oppretter beskyttet GitHub environment: $ENVIRONMENT"
gh api --method PUT "repos/$REPO/environments/$ENVIRONMENT" >/dev/null

say "Laster signing-materiale opp som krypterte environment secrets"
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set NEST_RELEASE_KEYSTORE_B64 -R "$REPO" -e "$ENVIRONMENT"
printf '%s' "$PASSWORD" | gh secret set NEST_RELEASE_STORE_PASSWORD -R "$REPO" -e "$ENVIRONMENT"
printf '%s' "$ALIAS" | gh secret set NEST_RELEASE_KEY_ALIAS -R "$REPO" -e "$ENVIRONMENT"
printf '%s' "$PASSWORD" | gh secret set NEST_RELEASE_KEY_PASSWORD -R "$REPO" -e "$ENVIRONMENT"
printf '%s' "$FINGERPRINT" | gh secret set NEST_RELEASE_CERT_SHA256 -R "$REPO" -e "$ENVIRONMENT"

say "Signing secrets er klare. Privatnøkkelen er ikke lagt i Git."
printf '\nNeste steg etter at v0.9-koden er på main:\n  gh workflow run release-v09.yml -R %s --ref main -f version=v0.9.0 -f publish=true\n\n' "$REPO"
printf 'VIKTIG: kopier %s og %s til to sikre offline-plasseringer før 1.0.\n' "$KEYSTORE" "$CREDENTIALS"
