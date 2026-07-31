package com.movie.ticket.dto;

import com.movie.ticket.entity.XianyuFulfillmentStatus;
import jakarta.validation.constraints.NotNull;

public record XianyuManualOrderRequest(
        @NotNull(message = "status is required")
        XianyuFulfillmentStatus status,
        String note
) {
}
