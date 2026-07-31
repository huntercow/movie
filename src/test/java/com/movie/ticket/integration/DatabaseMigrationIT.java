package com.movie.ticket.integration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class DatabaseMigrationIT {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0.36")
            .withDatabaseName("ticket_test")
            .withUsername("ticket_test")
            .withPassword("ticket_test");

    @Test
    void shouldApplyEveryFlywayMigrationToRealMySql() throws SQLException {
        assertThat(System.getProperty("integration.profile.enabled"))
                .as("integration tests must only run through the integration Maven profile")
                .isEqualTo("true");

        var result = Flyway.configure()
                .dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        assertThat(result.migrationsExecuted).isEqualTo(8);
        assertThat(tableExists("app_user")).isTrue();
        assertThat(tableExists("job_task")).isTrue();
        assertThat(columnExists("xianyu_platform_order", "amount_verified_at")).isTrue();
        assertThat(columnExists("xianyu_platform_order", "delivery_attempt_id")).isTrue();
    }

    private boolean tableExists(String tableName) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
             ResultSet result = connection.getMetaData().getTables(null, null, tableName, new String[]{"TABLE"})) {
            return result.next();
        }
    }

    private boolean columnExists(String tableName, String columnName) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
             ResultSet result = connection.getMetaData().getColumns(null, null, tableName, columnName)) {
            return result.next();
        }
    }
}
