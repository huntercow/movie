package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface XianyuMessageRepository extends JpaRepository<XianyuMessage, Long> {
    Optional<XianyuMessage> findByChatIdAndMessageId(String chatId, String messageId);

    Optional<XianyuMessage> findByUserIdAndChatIdAndMessageId(Long userId, String chatId, String messageId);

    List<XianyuMessage> findTop100ByOrderByCreatedAtDesc();

    List<XianyuMessage> findTop100ByUserIdOrderByCreatedAtDesc(Long userId);

    List<XianyuMessage> findTop100ByChatIdOrderByCreatedAtDesc(String chatId);

    List<XianyuMessage> findTop100ByUserIdAndChatIdOrderByCreatedAtDesc(Long userId, String chatId);
}
