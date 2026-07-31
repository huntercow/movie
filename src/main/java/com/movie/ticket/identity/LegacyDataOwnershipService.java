package com.movie.ticket.identity;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class LegacyDataOwnershipService {

    private static final List<String> USER_SCOPED_TABLES = List.of(
            "bot_message",
            "customer",
            "payment_record",
            "ticket_order",
            "ticket_quote",
            "xianyu_buyer",
            "xianyu_conversation",
            "xianyu_delivery_record",
            "xianyu_message",
            "xianyu_platform_order",
            "xianyu_reply_config",
            "xianyu_seller_account"
    );

    private final AppUserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;

    public LegacyDataOwnershipService(AppUserRepository userRepository, JdbcTemplate jdbcTemplate) {
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    public Long legacyOwnerId() {
        return userRepository.findFirstByRoleOrderByIdAsc(UserRole.ADMIN)
                .map(AppUser::getId)
                .orElse(null);
    }

    @Transactional
    public void claimExistingData(Long userId) {
        for (String table : USER_SCOPED_TABLES) {
            jdbcTemplate.update("UPDATE " + table + " SET user_id = ? WHERE user_id IS NULL", userId);
        }
        jdbcTemplate.update(
                "UPDATE xianyu_reply_config SET config_key = ? WHERE config_key = 'default'",
                "user:" + userId + ":default"
        );
    }
}
