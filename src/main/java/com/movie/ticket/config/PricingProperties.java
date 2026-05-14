package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.math.BigDecimal;

@ConfigurationProperties(prefix = "ticket.pricing")
public record PricingProperties(
        BigDecimal markupRate
) {
}
