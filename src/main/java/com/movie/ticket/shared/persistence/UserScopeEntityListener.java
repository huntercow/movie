package com.movie.ticket.shared.persistence;

import com.movie.ticket.security.UserScopeContext;
import jakarta.persistence.PrePersist;

public class UserScopeEntityListener {

    @PrePersist
    public void assignCurrentUser(UserScopedEntity entity) {
        if (entity.getUserId() == null) {
            entity.setUserId(UserScopeContext.get());
        }
    }
}
