package com.movie.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "Bot request for quoting a private chat ticket image")
public record BotImageQuoteRequest(
        @Schema(description = "Private WeChat user id or bot platform open id", example = "wx_19934419145")
        @NotBlank(message = "wechatId is required")
        String wechatId,

        @Schema(description = "Customer nickname", example = "Hunter")
        String nickname,

        @Schema(description = "Customer avatar URL")
        String avatarUrl,

        @Schema(description = "Bot platform message id for tracing", example = "msg_10001")
        @NotBlank(message = "messageId is required")
        String messageId,

        @Schema(description = "Ticket image base64")
        @NotBlank(message = "imageBase64 is required")
        String imageBase64
) {
}
