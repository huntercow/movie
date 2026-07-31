package com.movie.ticket.service;

import com.movie.ticket.config.PricingProperties;
import com.movie.ticket.exception.BusinessException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PricingServiceTest {

    private final PricingService service = new PricingService(new PricingProperties(
            new BigDecimal("0.10"),
            new BigDecimal("1.00")
    ));

    @Test
    void calculatesMarkupWithoutExceedingFaceValue() {
        assertThat(service.calculateFinalPrice(new BigDecimal("27.66"), new BigDecimal("33.00")))
                .isEqualByComparingTo("29.19");
        assertThat(service.calculateFinalPrice(new BigDecimal("32.80"), new BigDecimal("33.00")))
                .isEqualByComparingTo("33.00");
    }

    @Test
    void rejectsUpstreamPriceAboveFaceValue() {
        assertThatThrownBy(() -> service.calculateFinalPrice(new BigDecimal("33.01"), new BigDecimal("33.00")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("higher than max price");
    }
}
