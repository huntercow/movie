package com.movie.ticket.security;

public final class UserScopeContext {

    private static final ThreadLocal<Long> CURRENT_USER = new ThreadLocal<>();

    private UserScopeContext() {
    }

    public static Long get() {
        return CURRENT_USER.get();
    }

    public static void set(Long userId) {
        if (userId == null) {
            CURRENT_USER.remove();
        } else {
            CURRENT_USER.set(userId);
        }
    }

    public static void clear() {
        CURRENT_USER.remove();
    }
}
