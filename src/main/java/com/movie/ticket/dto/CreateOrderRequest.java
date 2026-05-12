package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateOrderRequest(
        @NotBlank(message = "quoteNo is required")
        String quoteNo,

        @NotBlank(message = "customerId is required")
        String customerId,

        String paymentNo
) {
}
