package com.movie.ticket.upstream;

public record UpstreamCancelOrderResult(
        String orderId,
        String rawRequest,
        String rawResponse
) {
}
