package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ticket.security")
public record CredentialEncryptionProperties(
        String credentialEncryptionKey
) {
}
