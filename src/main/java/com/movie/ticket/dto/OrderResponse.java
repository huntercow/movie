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
        Integer upstreamOrderStatus,
        String ticketCodeInfo,
        Integer submitRetryCount,
        String lastSubmitError,
        String lastSyncError,
        String status,
        String statusText,
        boolean terminal,
        boolean shouldPoll
) {
}
