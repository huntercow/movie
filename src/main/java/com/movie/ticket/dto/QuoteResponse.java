package com.movie.ticket.dto;

import java.math.BigDecimal;

public record QuoteResponse(
        String quoteNo,
        MovieTicketInfo ticketInfo,
        BigDecimal upstreamPrice,
        BigDecimal finalPrice,
        BigDecimal totalPrice,
        BigDecimal profit,
        String status
) {
}
