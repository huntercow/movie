package com.movie.ticket.agent;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AgentInstanceRepository extends JpaRepository<AgentInstance, Long> {
    Optional<AgentInstance> findByAgentTokenId(Long agentTokenId);

    Optional<AgentInstance> findByInstallationId(String installationId);

    List<AgentInstance> findAllByUserIdOrderByCreatedAtDesc(Long userId);
}
