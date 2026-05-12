package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateQuoteRequest(
        @NotBlank(message = "imageBase64 is required")
        String imageBase64,

        String customerId,
        String channel
) {
}
