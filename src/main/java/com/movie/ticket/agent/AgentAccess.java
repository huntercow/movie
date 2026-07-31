package com.movie.ticket.agent;

public record AgentAccess(
        Long userId,
        Long tokenId,
        Long instanceId,
        AgentType agentType
) {
}
