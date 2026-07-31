package com.movie.ticket.dto;

import jakarta.validation.constraints.Positive;

public record XianyuAdjustedOrderRequest(
        @Positive(message = "adjustedAmountCents must be positive") long adjustedAmountCents
) {
}
