package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuReplyConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface XianyuReplyConfigRepository extends JpaRepository<XianyuReplyConfig, String> {
    Optional<XianyuReplyConfig> findByUserIdAndConfigKey(Long userId, String configKey);
}
