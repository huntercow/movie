package com.movie.ticket.dto;

import com.movie.ticket.entity.SalesChannel;
import jakarta.validation.constraints.NotBlank;

public record CreateQuoteRequest(
        @NotBlank(message = "imageBase64 is required")
        String imageBase64,

        String customerId,
        SalesChannel channel
) {
}
