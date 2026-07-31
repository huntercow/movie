package com.movie.ticket.dto;

import java.time.LocalDateTime;

public record XianyuEventResponse(
        Long id,
        String chatId,
        String messageId,
        String senderUserId,
        String messageType,
        String quoteNo,
        String rawPayload,
        LocalDateTime createdAt
) {
}
