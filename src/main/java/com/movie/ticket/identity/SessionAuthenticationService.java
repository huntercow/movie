package com.movie.ticket.identity;

import com.movie.ticket.security.AppPrincipal;
import com.movie.ticket.security.SecretTokenService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;

@Service
public class SessionAuthenticationService {

    private static final Duration SESSION_DURATION = Duration.ofHours(12);
    private static final Duration LAST_USED_WRITE_INTERVAL = Duration.ofMinutes(5);

    private final UserSessionRepository sessionRepository;
    private final AppUserRepository userRepository;
    private final SecretTokenService tokenService;

    public SessionAuthenticationService(
            UserSessionRepository sessionRepository,
            AppUserRepository userRepository,
            SecretTokenService tokenService
    ) {
        this.sessionRepository = sessionRepository;
        this.userRepository = userRepository;
        this.tokenService = tokenService;
    }

    @Transactional
    public IssuedSession issue(AppUser user) {
        String rawToken = tokenService.generate("usr_");
        LocalDateTime now = LocalDateTime.now();
        UserSession session = new UserSession();
        session.setUserId(user.getId());
        session.setTokenHash(tokenService.hash(rawToken));
        session.setCreatedAt(now);
        session.setLastUsedAt(now);
        session.setExpiresAt(now.plus(SESSION_DURATION));
        sessionRepository.save(session);
        return new IssuedSession(rawToken, session.getExpiresAt());
    }

    @Transactional
    public Optional<AppPrincipal> authenticate(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return Optional.empty();
        }
        UserSession session = sessionRepository.findByTokenHash(tokenService.hash(rawToken)).orElse(null);
        LocalDateTime now = LocalDateTime.now();
        if (session == null || session.getRevokedAt() != null || !session.getExpiresAt().isAfter(now)) {
            return Optional.empty();
        }
        AppUser user = userRepository.findById(session.getUserId()).orElse(null);
        if (user == null || user.getStatus() != UserStatus.ACTIVE) {
            return Optional.empty();
        }
        if (session.getLastUsedAt() == null
                || session.getLastUsedAt().isBefore(now.minus(LAST_USED_WRITE_INTERVAL))) {
            session.setLastUsedAt(now);
            sessionRepository.save(session);
        }
        return Optional.of(new AppPrincipal(
                user.getId(),
                user.getUsername(),
                user.getRole(),
                user.isMustChangePassword()
        ));
    }

    @Transactional
    public void revoke(String rawToken) {
        sessionRepository.findByTokenHash(tokenService.hash(rawToken)).ifPresent(session -> {
            session.setRevokedAt(LocalDateTime.now());
            sessionRepository.save(session);
        });
    }

    @Transactional
    public void revokeAllForUser(Long userId) {
        LocalDateTime now = LocalDateTime.now();
        sessionRepository.findAllByUserIdAndRevokedAtIsNull(userId).forEach(session -> {
            session.setRevokedAt(now);
            sessionRepository.save(session);
        });
    }

    public record IssuedSession(String token, LocalDateTime expiresAt) {
    }
}
