package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@jakarta.persistence.EntityListeners(com.movie.ticket.shared.persistence.UserScopeEntityListener.class)
@jakarta.persistence.Table(
        uniqueConstraints = @jakarta.persistence.UniqueConstraint(
                name = "uk_xianyu_message_chat_message",
                columnNames = {"chat_id", "message_id"}
        )
)
public class XianyuMessage implements com.movie.ticket.shared.persistence.UserScopedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "chat_id", nullable = false, length = 128)
    private String chatId;

    @Column(name = "message_id", nullable = false, length = 128)
    private String messageId;

    @Column(length = 128)
    private String senderUserId;

    @Column(length = 64)
    private String quoteNo;

    @Column(length = 64)
    private String messageType;

    @Lob
    private String rawPayload;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        createdAt = LocalDateTime.now();
    }
}
