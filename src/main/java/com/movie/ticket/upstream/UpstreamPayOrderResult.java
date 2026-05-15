package com.movie.ticket.upstream;

public record UpstreamPayOrderResult(
        String orderNumber,
        String rawRequest,
        String rawResponse
) {
}
