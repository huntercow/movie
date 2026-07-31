package com.movie.ticket.agent.api;

import com.movie.ticket.identity.UserStatus;

public record AdminAgentView(
        Long userId,
        String username,
        UserStatus userStatus,
        AgentTokenView token
) {
}
