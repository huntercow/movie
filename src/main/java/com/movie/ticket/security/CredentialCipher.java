package com.movie.ticket.security;

import com.movie.ticket.config.CredentialEncryptionProperties;
import com.movie.ticket.exception.BusinessException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class CredentialCipher {

    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private final CredentialEncryptionProperties properties;
    private final SecureRandom secureRandom = new SecureRandom();

    public CredentialCipher(CredentialEncryptionProperties properties) {
        this.properties = properties;
    }

    public boolean isConfigured() {
        try {
            return key().length == 32;
        } catch (RuntimeException exception) {
            return false;
        }
    }

    public String encrypt(String plaintext) {
        if (!StringUtils.hasText(plaintext)) {
            throw new BusinessException("credential value is required");
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            secureRandom.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + encrypted.length)
                    .put(iv)
                    .put(encrypted)
                    .array());
        } catch (GeneralSecurityException exception) {
            throw new BusinessException("unable to encrypt upstream credentials");
        }
    }

    public String decrypt(String encoded) {
        try {
            byte[] value = Base64.getDecoder().decode(encoded);
            if (value.length <= IV_LENGTH) {
                throw new BusinessException("stored upstream credential is invalid");
            }
            byte[] iv = java.util.Arrays.copyOfRange(value, 0, IV_LENGTH);
            byte[] encrypted = java.util.Arrays.copyOfRange(value, IV_LENGTH, value.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException | GeneralSecurityException exception) {
            throw new BusinessException("unable to decrypt upstream credentials; verify the platform encryption key");
        }
    }

    private byte[] key() {
        String encoded = properties.credentialEncryptionKey();
        if (!StringUtils.hasText(encoded)) {
            throw new BusinessException("platform credential encryption key is not configured");
        }
        try {
            byte[] key = Base64.getDecoder().decode(encoded);
            if (key.length != 32) {
                throw new BusinessException("platform credential encryption key must decode to 32 bytes");
            }
            return key;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException("platform credential encryption key must be valid Base64");
        }
    }
}
