package com.movie.ticket.agent.api;

public record CreatedAgentTokenResponse(
        String token,
        AgentTokenView details
) {
}
