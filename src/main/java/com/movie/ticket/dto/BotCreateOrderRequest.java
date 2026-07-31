package com.movie.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Bot order creation request after payment confirmation")
public record BotCreateOrderRequest(
        @Schema(description = "Private WeChat user id", example = "wx_13800138000")
        @NotBlank(message = "wechatId is required")
        String wechatId,

        @Schema(description = "Quote number", example = "Q20260516120000ABCDEFGH")
        @NotBlank(message = "quoteNo is required")
        String quoteNo,

        @Schema(description = "Payment record number; latest CONFIRMED record will be used when blank")
        String paymentRecordNo
) {
}
