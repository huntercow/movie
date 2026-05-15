package com.movie.ticket.upstream;

import java.math.BigDecimal;
import java.util.List;

public record SubmitOrderCommand(
        String userId,
        String userName,
        String showId,
        List<String> seats,
        BigDecimal upstreamPrice,
        String officialQuotationId,
        String officialQuotationChannel
) {
}
