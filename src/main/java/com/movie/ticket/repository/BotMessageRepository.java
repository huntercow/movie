package com.movie.ticket.repository;

import com.movie.ticket.entity.BotMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface BotMessageRepository extends JpaRepository<BotMessage, Long> {
    Optional<BotMessage> findByWechatIdAndMessageId(String wechatId, String messageId);

    Optional<BotMessage> findByUserIdAndWechatIdAndMessageId(Long userId, String wechatId, String messageId);
}
