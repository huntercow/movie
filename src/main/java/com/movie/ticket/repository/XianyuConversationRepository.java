package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuConversation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.util.Optional;

public interface XianyuConversationRepository extends JpaRepository<XianyuConversation, Long> {
    Optional<XianyuConversation> findByChatId(String chatId);

    Optional<XianyuConversation> findByUserIdAndChatId(Long userId, String chatId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select conversation from XianyuConversation conversation where conversation.chatId = :chatId")
    Optional<XianyuConversation> findByChatIdForUpdate(@Param("chatId") String chatId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select conversation from XianyuConversation conversation where conversation.userId = :userId and conversation.chatId = :chatId")
    Optional<XianyuConversation> findByUserIdAndChatIdForUpdate(
            @Param("userId") Long userId,
            @Param("chatId") String chatId
    );
}
