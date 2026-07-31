package com.movie.ticket.agent;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface AgentTokenRepository extends JpaRepository<AgentToken, Long> {
    Optional<AgentToken> findByTokenHash(String tokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select token from AgentToken token where token.tokenHash = :tokenHash")
    Optional<AgentToken> findByTokenHashForUpdate(@Param("tokenHash") String tokenHash);

    List<AgentToken> findAllByUserIdOrderByCreatedAtDesc(Long userId);

    List<AgentToken> findAllByOrderByCreatedAtDesc();

    long countByUserIdAndAgentTypeAndStatusIn(
            Long userId,
            AgentType agentType,
            List<AgentTokenStatus> statuses
    );
}
