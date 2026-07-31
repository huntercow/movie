package com.movie.ticket.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;

public record XianyuReplyConfigRequest(
        @NotNull(message = "templates is required") JsonNode templates,
        @NotNull(message = "keywordRules is required") JsonNode keywordRules,
        boolean textFallbackEnabled
) {
}
