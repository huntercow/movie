package com.movie.ticket.upstream;

public record UpstreamOrderDetailResult(
        String orderId,
        String orderNumber,
        String rawResponse
) {
}
