import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;

/** Local packaging helper. Signing keys/passwords are supplied separately, never embedded. */
public final class ApkSign {
    public static void main(String[] args) throws Exception {
        if (args.length != 6) throw new IllegalArgumentException("input output keystore password-file alias min-sdk");
        char[] password = Files.readString(Path.of(args[3])).strip().toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var input = Files.newInputStream(Path.of(args[2]))) { store.load(input, password); }
        PrivateKey key = (PrivateKey) store.getKey(args[4], password);
        Arrays.fill(password, '\0');
        X509Certificate certificate = (X509Certificate) store.getCertificate(args[4]);
        if (key == null || certificate == null) throw new IllegalStateException("Signing alias not found");
        var signer = new ApkSigner.SignerConfig.Builder("YOURREST", key, List.of(certificate)).build();
        new ApkSigner.Builder(List.of(signer))
            .setInputApk(new File(args[0])).setOutputApk(new File(args[1]))
            .setMinSdkVersion(Integer.parseInt(args[5]))
            .setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true)
            .setV4SigningEnabled(false).setDebuggableApkPermitted(false)
            .setAlignmentPreserved(true).setCreatedBy("Yourrest native build")
            .build().sign();
        var result = new ApkVerifier.Builder(new File(args[1])).build().verify();
        if (!result.isVerified()) throw new IllegalStateException("APK verification failed: " + result.getAllErrors());
        String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
        System.out.println("APK signature verified: v1=" + result.isVerifiedUsingV1Scheme()
            + " v2=" + result.isVerifiedUsingV2Scheme() + " v3=" + result.isVerifiedUsingV3Scheme());
        System.out.println("Signing certificate SHA-256: " + fingerprint);
        if (!result.getWarnings().isEmpty()) System.out.println("Verifier warnings: " + result.getWarnings());
    }
}
