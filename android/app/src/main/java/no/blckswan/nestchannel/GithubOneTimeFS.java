package no.blckswan.nestchannel;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Experimental single-recipient, one-time-prekey GitHub mail transport.
 * This is NOT Signal Double Ratchet or MLS. Historical ciphertext can be
 * independent of CURRENT endpoint keys once the used receiver private prekey
 * is deleted. Undelivered messages remain vulnerable to endpoint compromise.
 *
 * Every peer identity MUST be verified out of band. Never silently TOFU.
 * Private one-time keys never transit the WebView bridge.
 */
final class GithubOneTimeFS {
    private static final String IDENTITY_ALIAS = "nest_github_fs1_identity";
    private static final String PREFIX = "nest_ghfs1.";
    private static final int MAX_PREKEYS = 16;
    private static final int MAX_MESSAGE_BYTES = 8192;
    private final SecureStore store;
    private final SecureRandom random = new SecureRandom();

    GithubOneTimeFS(SecureStore store) { this.store = store; }
    private static String b64(byte[] v) { return Base64.encodeToString(v, Base64.NO_WRAP); }
    private static byte[] unb64(String s) { return Base64.decode(s, Base64.NO_WRAP); }
    private static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    private static String digest(String s) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(utf8(s))); }
    private static String hex(byte[] v) {
        StringBuilder b = new StringBuilder();
        for (byte x : v) b.append(String.format(java.util.Locale.ROOT, "%02x", x & 255));
        return b.toString();
    }
    private static void checkRoom(String room) {
        if (room == null || !room.matches("[a-f0-9]{64}")) throw new SecurityException("Ugyldig kanal-ID");
    }
    private static String localKey(String room) { return PREFIX + room; }
    private static PublicKey publicKey(String encoded) throws Exception {
        byte[] der = unb64(encoded);
        if (der.length < 65 || der.length > 400) throw new SecurityException("Ugyldig offentlig nøkkel");
        return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
    }
    private static KeyPair newOneTimeKey() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        return g.generateKeyPair();
    }
    private synchronized KeyPair identity() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(IDENTITY_ALIAS)) {
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            g.initialize(new KeyGenParameterSpec.Builder(IDENTITY_ALIAS,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256).build());
            g.generateKeyPair();
        }
        KeyStore.PrivateKeyEntry entry=(KeyStore.PrivateKeyEntry) ks.getEntry(IDENTITY_ALIAS,null);
        return new KeyPair(entry.getCertificate().getPublicKey(),entry.getPrivateKey());
    }
    private static String signed(PrivateKey pk,String message) throws Exception {
        Signature s=Signature.getInstance("SHA256withECDSA");
        s.initSign(pk);s.update(utf8(message));return b64(s.sign());
    }
    private static boolean verified(PublicKey pk,String message,String signature) throws Exception {
        Signature s=Signature.getInstance("SHA256withECDSA");
        s.initVerify(pk);s.update(utf8(message));return s.verify(unb64(signature));
    }
    synchronized String fingerprint() {
        try {return hex(MessageDigest.getInstance("SHA-256").digest(identity().getPublic().getEncoded()));}
        catch(Exception e){throw new SecurityException("Identitet utilgjengelig",e);}
    }
    private static String canonicalKeys(JSONArray keys) throws Exception {
        StringBuilder out=new StringBuilder();
        if(keys.length()>MAX_PREKEYS || keys.length()==0) throw new SecurityException("Ugyldig nøkkelpakke");
        Set<String> known=new HashSet<>();
        for(int i=0;i<keys.length();i++) {
            JSONObject k=keys.getJSONObject(i);
            String id=k.getString("id"),pub=k.getString("pub");
            if(!id.matches("[a-f0-9-]{36}") || !known.add(id)) throw new SecurityException("Ugyldig engangsnøkkel");
            publicKey(pub);out.append(id).append(":").append(pub).append(";");
        }
        return out.toString();
    }
    private static String bundleText(String room,String identity,JSONArray keys) throws Exception {
        return "NEST-GH-FS1-BUNDLE|"+room+"|"+identity+"|"+canonicalKeys(keys);
    }
    synchronized String publicBundle(String room) {
        try {
            checkRoom(room);
            String p=localKey(room);
            JSONArray ids;
            String saved=store.get(p+".list");
            ids=saved.isEmpty()?new JSONArray():new JSONArray(saved);
            // Only prekeys still held on this device may be advertised.
            JSONArray present=new JSONArray();
            for(int i=0;i<ids.length();i++){
                JSONObject item=ids.getJSONObject(i);
                if(store.contains(p+".secret."+item.getString("id")))present.put(item);
            }
            while(present.length()<MAX_PREKEYS){
                KeyPair key=newOneTimeKey();
                String id=UUID.randomUUID().toString();
                byte[] secret=key.getPrivate().getEncoded();
                if(secret==null) throw new SecurityException("Engangsnøkkel mangler eksportformat");
                try {store.put(p+".secret."+id,b64(secret));}
                finally {Arrays.fill(secret,(byte)0);}
                present.put(new JSONObject().put("id",id).put("pub",b64(key.getPublic().getEncoded())));
            }
            store.put(p+".list",present.toString());
            KeyPair signing=identity();
            String identity64=b64(signing.getPublic().getEncoded());
            return new JSONObject().put("v",1).put("kind","prekeys").put("room",room)
                    .put("identity",identity64).put("fingerprint",fingerprint())
                    .put("keys",present)
                    .put("signature",signed(signing.getPrivate(),bundleText(room,identity64,present)))
                    .toString();
        }catch(Exception e){throw new SecurityException("Kunne ikke lage signerte engangsnøkler",e);}
    }
    private static String identityFromBundle(String room, JSONObject bundle) throws Exception {
        checkRoom(room);
        if(bundle.optInt("v")!=1 || !"prekeys".equals(bundle.optString("kind"))
                || !room.equals(bundle.optString("room")))throw new SecurityException("Feil kanal/nøkkelpakke");
        String identity64=bundle.getString("identity");
        PublicKey id=publicKey(identity64);
        String fp=hex(MessageDigest.getInstance("SHA-256").digest(id.getEncoded()));
        if(!fp.equals(bundle.optString("fingerprint")) || !verified(id,bundleText(room,identity64,bundle.getJSONArray("keys")),bundle.getString("signature")))
            throw new SecurityException("Nøkkelpakke har ugyldig signatur");
        return fp;
    }
    synchronized String inspectBundle(String room,String json) {
        try {return identityFromBundle(room,new JSONObject(json));}
        catch(Exception e){throw new SecurityException("Ugyldig mottakernøkkel",e);}
    }
    synchronized String pinnedFingerprint(String room) {
        try {checkRoom(room);return store.get(localKey(room)+".pinned");}
        catch(Exception e){throw new SecurityException("Kunne ikke lese paret identitet",e);}
    }
    synchronized void pinVerified(String room,String json,String manuallyCheckedSuffix) {
        try {
            JSONObject b=new JSONObject(json);
            String fp=identityFromBundle(room,b);
            if(fp.equals(fingerprint()))throw new SecurityException("Kan ikke pare med egen identitet");
            // The user must read the 12-character suffix independently from
            // the SECOND DEVICE and enter it. Never auto-accept server metadata.
            if(manuallyCheckedSuffix==null || !fp.endsWith(manuallyCheckedSuffix.trim().toLowerCase(java.util.Locale.ROOT))
                    || manuallyCheckedSuffix.trim().length()!=12)
                throw new SecurityException("Identitetskoden stemmer ikke med den andre telefonen");
            String existing=pinnedFingerprint(room);
            if(!existing.isEmpty() && !existing.equals(fp))
                throw new SecurityException("Kanalen er paret mot en annen identitet");
            store.put(localKey(room)+".pinned",fp);
        }catch(Exception e){throw new SecurityException("Sikker identitetsparing feilet",e);}
    }
    private static byte[] derive(byte[] shared,String context) throws Exception {
        byte[] salt=MessageDigest.getInstance("SHA-256").digest(utf8(context));
        Mac m=Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(salt,"HmacSHA256"));
        byte[] prk=m.doFinal(shared);
        try {
            m.init(new SecretKeySpec(prk,"HmacSHA256"));
            m.update(utf8("NEST-GH-FS1-MESSAGE"));
            m.update((byte)1);
            return m.doFinal();
        }finally{Arrays.fill(prk,(byte)0);Arrays.fill(salt,(byte)0);}
    }
    private static String metadata(String room,String sender,String recipient,
                                   String keyId,String eph,String messageId) {
        return "NEST-GH-FS1|"+room+"|"+sender+"|"+recipient+"|"+keyId+"|"+eph+"|"+messageId;
    }
    private static byte[] shared(PrivateKey priv,PublicKey pub) throws Exception {
        KeyAgreement k=KeyAgreement.getInstance("ECDH");
        k.init(priv);k.doPhase(pub,true);return k.generateSecret();
    }
    synchronized String encrypt(String room,String payload,String bundleJson) {
        try {
            checkRoom(room);
            if(payload==null || utf8(payload).length>MAX_MESSAGE_BYTES)throw new SecurityException("Melding er for stor");
            JSONObject b=new JSONObject(bundleJson);
            String fp=identityFromBundle(room,b);
            if(!fp.equals(pinnedFingerprint(room)))throw new SecurityException("Mottakerens identitet er ikke verifisert");
            String recipient=b.getString("identity"),sender=b64(identity().getPublic().getEncoded());
            if(recipient.equals(sender))throw new SecurityException("Kan ikke sende til egen telefon");
            JSONArray keys=b.getJSONArray("keys");
            String usedKey=localKey(room)+".sent."+fp;
            String consumed=store.get(usedKey);
            Set<String> used=new HashSet<>();
            if(!consumed.isEmpty()){
                JSONArray a=new JSONArray(consumed);for(int i=0;i<a.length();i++)used.add(a.getString(i));
            }
            JSONObject selected=null;
            for(int i=0;i<keys.length();i++)if(!used.contains(keys.getJSONObject(i).getString("id"))){
                selected=keys.getJSONObject(i);break;
            }
            if(selected==null)throw new SecurityException("Mottaker mangler ledige engangsnøkler, oppdater kanal");
            String keyId=selected.getString("id");
            // Burn this remote prekey before allowing any ciphertext to escape.
            // A failed network send sacrifices availability rather than reusing.
            used.add(keyId);
            JSONArray next=new JSONArray();for(String id:used)next.put(id);
            if(next.length()>8192)throw new SecurityException("For mange sendte engangsnøkler");
            store.put(usedKey,next.toString());
            KeyPair eph=newOneTimeKey();
            String eph64=b64(eph.getPublic().getEncoded());
            String msgid=UUID.randomUUID().toString();
            String ctx=metadata(room,sender,recipient,keyId,eph64,msgid);
            byte[] raw=shared(eph.getPrivate(),publicKey(selected.getString("pub")));
            byte[] derived=null;
            try {
                derived=derive(raw,ctx);
                byte[] iv=new byte[12];random.nextBytes(iv);
                Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(derived,"AES"),new GCMParameterSpec(128,iv));
                c.updateAAD(utf8(ctx));
                byte[] ct=c.doFinal(utf8(payload));
                String nonce=b64(iv),ciphertext=b64(ct);
                String canonical=ctx+"|"+nonce+"|"+ciphertext;
                return new JSONObject().put("v",1).put("kind","sealed").put("room",room)
                        .put("id",msgid).put("sender",sender).put("recipient",recipient)
                        .put("prekey",keyId).put("ephemeral",eph64)
                        .put("iv",nonce).put("data",ciphertext)
                        .put("signature",signed(identity().getPrivate(),canonical)).toString();
            }finally {Arrays.fill(raw,(byte)0);if(derived!=null)Arrays.fill(derived,(byte)0);}
        }catch(Exception e){throw new SecurityException("Kryptert GitHub-sending feilet: "+e.getMessage(),e);}
    }
    synchronized String decrypt(String room,String envelopeJson) {
        try {
            checkRoom(room);
            if(envelopeJson==null || envelopeJson.length()>24000)throw new SecurityException("Kryptert pakke for stor");
            JSONObject env=new JSONObject(envelopeJson);
            if(env.optInt("v")!=1 || !"sealed".equals(env.optString("kind")) || !room.equals(env.optString("room")))
                throw new SecurityException("Ugyldig meldingsramme");
            String sender=env.getString("sender"),recipient=env.getString("recipient");
            if(!recipient.equals(b64(identity().getPublic().getEncoded())))return "";
            String fp=hex(MessageDigest.getInstance("SHA-256").digest(publicKey(sender).getEncoded()));
            if(!fp.equals(pinnedFingerprint(room)))throw new SecurityException("Avsender ikke verifisert");
            String prekey=env.getString("prekey"),ephemeral=env.getString("ephemeral"),id=env.getString("id");
            if(!prekey.matches("[a-f0-9-]{36}") || !id.matches("[a-f0-9-]{36}"))throw new SecurityException("Ugyldig nøkkel-ID");
            String ctx=metadata(room,sender,recipient,prekey,ephemeral,id);
            String iv=env.getString("iv"),data=env.getString("data");
            if(!verified(publicKey(sender),ctx+"|"+iv+"|"+data,env.getString("signature")))
                throw new SecurityException("Melding har ugyldig signatur");
            String prefix=localKey(room),entry=prefix+".secret."+prekey;
            String encoded=store.get(entry);
            if(encoded.isEmpty())return ""; // Already consumed or not intended for this device
            byte[] pkcs8=unb64(encoded);
            PrivateKey priv=KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
            Arrays.fill(pkcs8,(byte)0);
            // Critical: consume private key on disk BEFORE decrypting.
            store.remove(entry);
            byte[] raw=shared(priv,publicKey(ephemeral));
            byte[] derived=null;
            try {
                derived=derive(raw,ctx);
                byte[] nonce=unb64(iv);
                if(nonce.length!=12)throw new SecurityException("Ugyldig AES-GCM nonce");
                Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(derived,"AES"),new GCMParameterSpec(128,nonce));
                c.updateAAD(utf8(ctx));
                byte[] decoded=c.doFinal(unb64(data));
                if(decoded.length>MAX_MESSAGE_BYTES)throw new SecurityException("Melding for stor");
                return new String(decoded,StandardCharsets.UTF_8);
            }finally{Arrays.fill(raw,(byte)0);if(derived!=null)Arrays.fill(derived,(byte)0);}
        }catch(Exception e){throw new SecurityException("GitHub FS-melding ble avvist: "+e.getMessage(),e);}
    }
}
