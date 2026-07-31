package com.movie.ticket.identity;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.List;

public interface UserSessionRepository extends JpaRepository<UserSession, Long> {
    Optional<UserSession> findByTokenHash(String tokenHash);

    List<UserSession> findAllByUserIdAndRevokedAtIsNull(Long userId);
}
