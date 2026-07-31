package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record XianyuEventRequest(
        @NotBlank(message = "eventType is required")
        String eventType,
        @NotBlank(message = "chatId is required")
        String chatId,
        String platformOrderId,
        @NotBlank(message = "messageId is required")
        String messageId,
        String rawPayload
) {
}
