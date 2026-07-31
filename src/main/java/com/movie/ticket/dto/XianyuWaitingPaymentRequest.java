package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record XianyuWaitingPaymentRequest(
        @NotBlank(message = "platformOrderId is required") String platformOrderId,
        @NotBlank(message = "chatId is required") String chatId,
        @NotBlank(message = "buyerUserId is required") String buyerUserId,
        String sellerUserId,
        @NotBlank(message = "itemId is required") String itemId,
        @NotBlank(message = "messageId is required") String messageId
) {
}
