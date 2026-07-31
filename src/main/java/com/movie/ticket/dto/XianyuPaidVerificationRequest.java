package com.movie.ticket.dto;

import com.movie.ticket.entity.XianyuAmountVerificationSource;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

public record XianyuPaidVerificationRequest(
        @Positive(message = "paidAmountCents must be positive") long paidAmountCents,
        @Positive(message = "itemTotalCents must be positive") long itemTotalCents,
        @NotNull(message = "postFeeCents is required")
        @PositiveOrZero(message = "postFeeCents cannot be negative") Long postFeeCents,
        @NotNull(message = "source is required") XianyuAmountVerificationSource source
) {
}
