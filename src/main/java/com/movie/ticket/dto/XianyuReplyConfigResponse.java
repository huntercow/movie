package com.movie.ticket.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.LocalDateTime;

public record XianyuReplyConfigResponse(
        String configKey,
        JsonNode templates,
        JsonNode keywordRules,
        boolean textFallbackEnabled,
        LocalDateTime updatedAt
) {
}
