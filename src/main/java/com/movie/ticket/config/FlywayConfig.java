package com.movie.ticket.config;

import org.flywaydb.core.api.MigrationVersion;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

    @Bean
    FlywayConfigurationCustomizer ticketFlywayConfiguration() {
        return configuration -> configuration
                .baselineOnMigrate(true)
                .baselineVersion(MigrationVersion.fromVersion("0"));
    }
}
