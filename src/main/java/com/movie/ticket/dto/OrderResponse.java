package com.movie.ticket.dto;

import java.math.BigDecimal;

public record OrderResponse(
        String orderNo,
        String quoteNo,
        String customerId,
        BigDecimal finalPrice,
        BigDecimal totalPrice,
        String upstreamOrderId,
        String upstreamOrderNo,
        Integer submitRetryCount,
        String lastSubmitError,
        String status
) {
}
