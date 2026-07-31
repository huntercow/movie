package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentToken;
import com.movie.ticket.agent.AgentTokenStatus;
import com.movie.ticket.agent.AgentType;

import java.time.LocalDateTime;

public record AgentTokenView(
        Long id,
        AgentType agentType,
        String tokenPrefix,
        AgentTokenStatus status,
        LocalDateTime expiresAt,
        LocalDateTime lastUsedAt,
        LocalDateTime createdAt,
        AgentInstanceView instance
) {
    public static AgentTokenView from(AgentToken token, AgentInstanceView instance) {
        return new AgentTokenView(
                token.getId(),
                token.getAgentType(),
                token.getTokenPrefix(),
                token.getStatus(),
                token.getExpiresAt(),
                token.getLastUsedAt(),
                token.getCreatedAt(),
                instance
        );
    }
}
