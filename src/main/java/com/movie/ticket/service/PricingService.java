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
        BigDecimal markupRate = requireNonNegative(properties.markupRate(), "pricing markup rate");
        BigDecimal fixedMarkup = requireNonNegative(properties.fixedMarkup(), "pricing fixed markup");
        BigDecimal availableProfit = maxPrice.subtract(upstreamPrice);
        BigDecimal expectedProfit = availableProfit.multiply(markupRate).add(fixedMarkup);
        BigDecimal profit = expectedProfit.min(availableProfit);
        return upstreamPrice.add(profit).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal requireNonNegative(BigDecimal value, String name) {
        if (value == null || value.compareTo(BigDecimal.ZERO) < 0) {
            throw new BusinessException(name + " must be configured and cannot be negative");
        }
        return value;
    }
}
