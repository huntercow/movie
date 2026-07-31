package com.movie.ticket.dto;

public record XianyuLatestQuoteResponse(
        String chatId,
        String quoteNo,
        QuoteResponse quote,
        String replyMessage
) {
}
