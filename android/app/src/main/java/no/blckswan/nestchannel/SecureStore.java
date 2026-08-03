package no.blckswan.nestchannel;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "nest_channel_secure_v1";
    private static final String PREFS = "nest_channel_secure_values";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final SharedPreferences preferences;

    SecureStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized void put(String key, String value) {
        if (key == null || key.isBlank()) return;
        if (value == null || value.isEmpty()) {
            remove(key);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                    + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            preferences.edit().putString(key, stored).apply();
        } catch (Exception error) {
            throw new IllegalStateException("Kunne ikke lagre hemmelig verdi", error);
        }
    }

    synchronized String get(String key) {
        String stored = preferences.getString(key, "");
        if (stored == null || stored.isEmpty()) return "";
        try {
            String[] pieces = stored.split("\\.", 2);
            if (pieces.length != 2) return "";
            byte[] iv = Base64.decode(pieces[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(pieces[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception error) {
            preferences.edit().remove(key).apply();
            return "";
        }
    }

    synchronized void remove(String key) {
        preferences.edit().remove(key).apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(ALIAS, null);
            return entry.getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
