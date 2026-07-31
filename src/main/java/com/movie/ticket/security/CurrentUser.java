package com.movie.ticket.security;

import com.movie.ticket.exception.BusinessException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CurrentUser {

    public AppPrincipal require() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AppPrincipal principal)) {
            throw new BusinessException("authentication is required");
        }
        return principal;
    }

    public Long id() {
        return require().userId();
    }
}
