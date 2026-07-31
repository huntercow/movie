package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentType;

public record AgentActivationResponse(
        Long userId,
        AgentType agentType,
        AgentInstanceView instance
) {
}
