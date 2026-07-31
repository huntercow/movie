package com.movie.ticket.identity.api;

import com.movie.ticket.identity.AppUser;
import com.movie.ticket.identity.UserRole;
import com.movie.ticket.identity.UserStatus;
import java.time.LocalDateTime;

public record UserView(
        Long id,
        String username,
        UserRole role,
        UserStatus status,
        boolean mustChangePassword,
        LocalDateTime lastLoginAt
) {
    public static UserView from(AppUser user) {
        return new UserView(
                user.getId(),
                user.getUsername(),
                user.getRole(),
                user.getStatus(),
                user.isMustChangePassword(),
                user.getLastLoginAt()
        );
    }
}
