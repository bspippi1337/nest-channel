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
  local missing=0
  command -v keytool >/dev/null 2>&1 || missing=1
  command -v gh >/dev/null 2>&1 || missing=1
  command -v openssl >/dev/null 2>&1 || missing=1
  if [ "$missing" -eq 1 ]; then
    say "Installerer Termux-avhengigheter (OpenJDK 17, gh, OpenSSL)"
    pkg install -y openjdk-17 gh openssl coreutils
  fi
}

install_termux_deps
command -v keytool >/dev/null 2>&1 || fail "keytool mangler (installer Java 17)."
command -v gh >/dev/null 2>&1 || fail "GitHub CLI mangler."
command -v openssl >/dev/null 2>&1 || fail "OpenSSL mangler."
command -v base64 >/dev/null 2>&1 || fail "base64 mangler."

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [ -e "$KEYSTORE" ]; then
  fail "Nøkkelen finnes allerede: $KEYSTORE. Nekter å overskrive app-identiteten."
fi

PASSWORD="$(openssl rand -hex 32)"

say "Genererer langsiktig NEST app-signing key lokalt"
keytool -genkeypair \
  -noprompt \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -sigalg SHA256withRSA \
  -validity 10000 \
  -storetype PKCS12 \
  -keystore "$KEYSTORE" \
  -storepass "$PASSWORD" \
  -keypass "$PASSWORD" \
  -dname "CN=NEST Channel, OU=Release, O=BLCKSWAN, C=NO"
chmod 600 "$KEYSTORE"

keytool -exportcert -rfc \
  -alias "$ALIAS" \
  -keystore "$KEYSTORE" \
  -storepass "$PASSWORD" \
  -file "$CERT" >/dev/null
chmod 644 "$CERT"

FINGERPRINT="$(keytool -list -v -alias "$ALIAS" -keystore "$KEYSTORE" -storepass "$PASSWORD" 2>/dev/null | awk -F': ' '/SHA256:/{print $2; exit}')"
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
