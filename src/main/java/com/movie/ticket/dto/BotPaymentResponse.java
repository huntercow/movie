package com.movie.ticket.dto;

import com.movie.ticket.entity.PaymentStatus;
import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;

@Schema(description = "Payment record response")
public record BotPaymentResponse(
        @Schema(description = "Payment record number")
        String paymentRecordNo,

        @Schema(description = "Local customer number")
        String customerNo,

        @Schema(description = "Quote number")
        String quoteNo,

        @Schema(description = "Confirmed payment amount")
        BigDecimal amount,

        @Schema(description = "Payment status")
        PaymentStatus status
) {
}
