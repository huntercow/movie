package com.movie.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

@Schema(description = "Bot or manual payment confirmation request")
public record BotPaymentConfirmRequest(
        @Schema(description = "Private WeChat user id", example = "wx_19934419145")
        @NotBlank(message = "wechatId is required")
        String wechatId,

        @Schema(description = "Quote number", example = "Q20260516120000ABCDEFGH")
        @NotBlank(message = "quoteNo is required")
        String quoteNo,

        @Schema(description = "Confirmed payment amount", example = "58.38")
        @NotNull(message = "amount is required")
        @DecimalMin(value = "0.01", message = "amount must be greater than 0")
        BigDecimal amount,

        @Schema(description = "WeChat transfer number or bot platform payment event id")
        String paymentNo,

        @Schema(description = "Payment proof image URL")
        String proofImageUrl,

        @Schema(description = "Operator who confirmed the payment")
        String confirmer,

        @Schema(description = "Payment remark")
        String remark
) {
}
