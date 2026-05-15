package com.movie.ticket.upstream;

public record UpstreamSubmitOrderResult(
        String orderNumber,
        String rawRequest,
        String rawResponse
) {
}
