package com.movie.ticket.agent.api;

import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

public record UpdateAgentTokenExpiryRequest(
        @NotNull LocalDateTime expiresAt
) {
}
