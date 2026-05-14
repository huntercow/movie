package com.movie.ticket.service;

import com.movie.ticket.config.PricingProperties;
import com.movie.ticket.exception.BusinessException;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;

@Service
public class PricingService {

    private final PricingProperties properties;

    public PricingService(PricingProperties properties) {
        this.properties = properties;
    }

    public BigDecimal calculateFinalPrice(BigDecimal upstreamPrice, BigDecimal maxPrice) {
        if (upstreamPrice == null || upstreamPrice.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessException("invalid upstream price");
        }
        if (maxPrice == null || maxPrice.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessException("invalid max price");
        }
        if (upstreamPrice.compareTo(maxPrice) > 0) {
            throw new BusinessException("quote failed: upstream price is higher than max price");
        }
        BigDecimal markupRate = defaultValue(properties.markupRate(), BigDecimal.ZERO);
        BigDecimal fixedMarkup = defaultValue(properties.fixedMarkup(), BigDecimal.ZERO);
        BigDecimal availableProfit = maxPrice.subtract(upstreamPrice);
        BigDecimal expectedProfit = availableProfit.multiply(markupRate).add(fixedMarkup);
        BigDecimal profit = expectedProfit.min(availableProfit);
        return upstreamPrice.add(profit).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal defaultValue(BigDecimal value, BigDecimal fallback) {
        return value == null ? fallback : value;
    }
}
