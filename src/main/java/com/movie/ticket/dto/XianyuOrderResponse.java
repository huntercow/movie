package com.movie.ticket.dto;

import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.entity.XianyuAmountVerificationSource;
import com.movie.ticket.entity.XianyuDeliveryAttemptOutcome;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record XianyuOrderResponse(
        String platformOrderId,
        String tradeNo,
        String chatId,
        String buyerUserId,
        String itemId,
        String quoteNo,
        String localOrderNo,
        BigDecimal paidAmount,
        BigDecimal quotedAmount,
        XianyuFulfillmentStatus status,
        String lastError,
        OrderResponse order,
        boolean shouldPoll,
        boolean shouldDeliver,
        String deliveryMessage,
        String ticketCodeInfo,
        BigDecimal adjustedAmount,
        XianyuAmountVerificationSource amountVerificationSource,
        LocalDateTime adjustedAt,
        LocalDateTime amountVerifiedAt,
        String deliveryAttemptId,
        LocalDateTime deliveryAttemptStartedAt,
        XianyuDeliveryAttemptOutcome deliveryAttemptOutcome,
        String deliveryAttemptChannel,
        String deliveryAttemptErrorMessage,
        LocalDateTime deliveryOutcomeRecordedAt
) {
}
