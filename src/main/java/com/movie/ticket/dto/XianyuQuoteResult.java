package com.movie.ticket.dto;

public record XianyuQuoteResult(
        String chatId,
        String messageId,
        boolean duplicated,
        String quoteNo,
        QuoteResponse quote,
        String replyMessage
) {
}
