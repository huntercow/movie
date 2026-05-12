package com.movie.ticket.service;

import com.movie.ticket.config.PricingProperties;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;

@Service
public class PricingService {

    private final PricingProperties properties;

    public PricingService(PricingProperties properties) {
        this.properties = properties;
    }

    public BigDecimal calculateFinalPrice(BigDecimal upstreamPrice) {
        BigDecimal markupRate = defaultValue(properties.markupRate(), BigDecimal.ZERO);
        BigDecimal fixedMarkup = defaultValue(properties.fixedMarkup(), BigDecimal.ZERO);
        BigDecimal minProfit = defaultValue(properties.minProfit(), BigDecimal.ZERO);
        BigDecimal rateProfit = upstreamPrice.multiply(markupRate);
        BigDecimal profit = rateProfit.add(fixedMarkup).max(minProfit);
        return upstreamPrice.add(profit).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal defaultValue(BigDecimal value, BigDecimal fallback) {
        return value == null ? fallback : value;
    }
}
