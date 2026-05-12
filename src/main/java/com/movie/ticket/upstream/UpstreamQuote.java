package com.movie.ticket.upstream;

import java.math.BigDecimal;

public record UpstreamQuote(
        BigDecimal price,
        String rawResponse
) {
}
