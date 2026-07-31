package com.movie.ticket.dto;

import com.movie.ticket.entity.XianyuFulfillmentStatus;

public record XianyuWaitingPaymentResponse(
        String platformOrderId,
        String quoteNo,
        long totalPriceCents,
        XianyuFulfillmentStatus status
) {
}
