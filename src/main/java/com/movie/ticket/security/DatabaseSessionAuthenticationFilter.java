package com.movie.ticket.security;

import com.movie.ticket.identity.SessionAuthenticationService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class DatabaseSessionAuthenticationFilter extends OncePerRequestFilter {

    private final SessionAuthenticationService authenticationService;

    public DatabaseSessionAuthenticationFilter(SessionAuthenticationService authenticationService) {
        this.authenticationService = authenticationService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith("Bearer ")) {
            String rawToken = authorization.substring("Bearer ".length()).trim();
            authenticationService.authenticate(rawToken).ifPresent(principal -> {
                var authentication = new UsernamePasswordAuthenticationToken(
                        principal,
                        rawToken,
                        List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name()))
                );
                SecurityContextHolder.getContext().setAuthentication(authentication);
                UserScopeContext.set(principal.userId());
            });
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            UserScopeContext.clear();
        }
    }
}
