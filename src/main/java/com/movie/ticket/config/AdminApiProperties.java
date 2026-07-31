package com.movie.ticket.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ticket.admin")
public record AdminApiProperties(
        String apiToken
) {
}
