package com.movie.ticket.identity.api;

import java.time.LocalDateTime;

public record AuthResponse(
        String accessToken,
        LocalDateTime expiresAt,
        UserView user
) {
}
