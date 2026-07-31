package com.movie.ticket.service;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

class XianyuDeliveryAttemptMigrationContractTest {

    @Test
    void v7RetainsItsPublishedChecksumAndContainsNoLegacyClaimQuarantine() throws Exception {
        Path migrationPath = Path.of(
                "src/main/resources/db/migration/V7__xianyu_delivery_attempt.sql"
        );
        String migration = Files.readString(migrationPath);

        assertThat(sha256(Files.readAllBytes(migrationPath)))
                .isEqualTo("9fe06c2ada881ee5890ac6c08d8ce1737b59dae37369aee675876f3aa8e423ea");
        assertThat(migration).doesNotContainIgnoringCase("UPDATE xianyu_platform_order");
        assertThat(migration).doesNotContain("LEGACY_DELIVERY_CLAIM_OUTCOME_UNKNOWN");
    }

    @Test
    void v8QuarantinesLegacyClaimedOrdersBeforeTheyCanReceiveANewAttempt() throws Exception {
        Path migrationPath = Path.of(
                "src/main/resources/db/migration/V8__quarantine_legacy_xianyu_delivery_claims.sql"
        );
        assertThat(migrationPath).exists();
        String migration = Files.readString(migrationPath);

        assertThat(migration).containsIgnoringCase("UPDATE xianyu_platform_order");
        assertThat(migration).contains("status = 'NEED_MANUAL'");
        assertThat(migration).contains("last_error = 'LEGACY_DELIVERY_CLAIM_OUTCOME_UNKNOWN'");
        assertThat(migration).contains("delivery_claimed_at = NULL");
        assertThat(migration).contains("status = 'ISSUED_WAIT_DELIVER'");
        assertThat(migration).contains("delivery_claimed_at IS NOT NULL");
        assertThat(migration).contains("delivery_attempt_id IS NULL");
        assertThat(migration).doesNotContainIgnoringCase("ALTER TABLE");
    }

    private String sha256(byte[] content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
    }
}
