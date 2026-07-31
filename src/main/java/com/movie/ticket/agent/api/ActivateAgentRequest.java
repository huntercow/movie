package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record ActivateAgentRequest(
        @NotBlank String token,
        @NotNull AgentType agentType,
        @NotBlank @Size(max = 128) String installationId,
        @Size(max = 128) String instanceName,
        @Size(max = 64) String clientVersion,
        @Size(max = 128) String currentXianyuAccountId,
        @Size(max = 128) String currentXianyuNickname
) {
}
