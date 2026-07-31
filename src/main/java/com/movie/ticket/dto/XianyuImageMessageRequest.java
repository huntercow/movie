package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record XianyuImageMessageRequest(
        @NotBlank(message = "chatId is required")
        String chatId,
        @NotBlank(message = "messageId is required")
        String messageId,
        String buyerUserId,
        String buyerNickname,
        String sellerUserId,
        String itemId,
        String imageUrl,
        @NotBlank(message = "imageBase64 is required")
        String imageBase64,
        String rawPayload
) {
}
