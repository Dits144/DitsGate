package id.ditsgate.listener;

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

final class ListenerSettings {
    private static final String ALIAS = "ditsgate_listener_device_token";
    private final SharedPreferences prefs;

    ListenerSettings(Context context) { prefs = context.getSharedPreferences("listener", Context.MODE_PRIVATE); }
    String endpoint() { return prefs.getString("endpoint", ""); }
    String sourcePackage() { return prefs.getString("source_package", ""); }
    boolean enabled() { return prefs.getBoolean("enabled", false); }
    void configure(String endpoint, String sourcePackage, String token) throws Exception {
        String encrypted = encrypt(token);
        if (!prefs.edit().putString("endpoint", endpoint).putString("source_package", sourcePackage)
            .putString("token", encrypted).putBoolean("enabled", true).commit()) throw new IllegalStateException("Penyimpanan konfigurasi gagal");
    }
    void disable() { prefs.edit().putBoolean("enabled", false).remove("token").commit(); }
    String token() throws Exception {
        String raw = prefs.getString("token", null);
        if (raw == null || !enabled()) return null;
        byte[] combined = Base64.decode(raw, Base64.NO_WRAP);
        if (combined.length <= 12) throw new IllegalStateException("Token terenkripsi tidak valid");
        byte[] iv = java.util.Arrays.copyOfRange(combined, 0, 12);
        byte[] cipherText = java.util.Arrays.copyOfRange(combined, 12, combined.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
    }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.SecretKeyEntry existing = (KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null);
        if (existing != null) return existing.getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV(), ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }
}
