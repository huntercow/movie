package com.movie.ticket.upstreamaccount;

import java.time.LocalDateTime;

public record UpstreamAccountView(
        boolean configured,
        String provider,
        String username,
        UpstreamAccountStatus status,
        LocalDateTime lastLoginAt,
        String lastError,
        LocalDateTime updatedAt,
        boolean encryptionConfigured
) {
}
