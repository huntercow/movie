package com.movie.ticket.upstream;

public record UpstreamOrderDetailResult(
        String orderId,
        String orderNumber,
        Integer orderStatus,
        String ticketCodeInfo,
        String lastSyncError,
        String rawResponse
) {
}
