package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentType;
import jakarta.validation.constraints.NotNull;

public record CreateAgentTokenRequest(
        @NotNull AgentType agentType
) {
}
