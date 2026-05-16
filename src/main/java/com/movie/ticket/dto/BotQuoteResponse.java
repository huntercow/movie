package com.movie.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Bot quote response")
public record BotQuoteResponse(
        @Schema(description = "Local customer number")
        String customerNo,

        @Schema(description = "Bot platform message id")
        String messageId,

        @Schema(description = "Whether this response is replayed by message id idempotency")
        boolean duplicated,

        @Schema(description = "Whether this quote is the customer's latest quote")
        boolean latest,

        @Schema(description = "Customer latest quote number")
        String latestQuoteNo,

        @Schema(description = "Quote details")
        QuoteResponse quote
) {
}
