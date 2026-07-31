package com.movie.ticket.controller.app;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;

public record AppManualOrderRequest(
        @NotBlank String quoteNo,
        String customerId,
        String paymentNo,
        @AssertTrue(message = "confirmed must be true before creating a real order") boolean confirmed
) {
}
