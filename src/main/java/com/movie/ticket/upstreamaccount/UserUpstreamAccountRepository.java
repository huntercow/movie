package com.movie.ticket.upstreamaccount;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserUpstreamAccountRepository extends JpaRepository<UserUpstreamAccount, Long> {
    Optional<UserUpstreamAccount> findByUserId(Long userId);
}
