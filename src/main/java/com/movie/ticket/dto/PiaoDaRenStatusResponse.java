package com.movie.ticket.dto;

import java.time.LocalDateTime;

public record PiaoDaRenStatusResponse(
        String provider,
        boolean mockEnabled,
        boolean autoLogin,
        String baseUrl,
        String h5BaseUrl,
        boolean loggedIn,
        String tokenPreview,
        String userId,
        String userName,
        String nickname,
        LocalDateTime lastLoginAt
) {
}
