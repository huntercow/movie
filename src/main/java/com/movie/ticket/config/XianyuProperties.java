package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ticket.xianyu")
public record XianyuProperties(
        Boolean autoFulfillmentEnabled
) {
    public boolean isAutoFulfillmentEnabled() {
        return Boolean.TRUE.equals(autoFulfillmentEnabled);
    }
}
