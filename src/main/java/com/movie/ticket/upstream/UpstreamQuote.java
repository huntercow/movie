package com.movie.ticket.upstream;

import java.math.BigDecimal;

public record UpstreamQuote(
        BigDecimal price,
        String taskId,
        String selectedChannel,
        String rawResponse
) {
}
