package com.movie.ticket.security;

import com.movie.ticket.identity.UserRole;

public record AppPrincipal(
        Long userId,
        String username,
        UserRole role,
        boolean mustChangePassword
) {
}
