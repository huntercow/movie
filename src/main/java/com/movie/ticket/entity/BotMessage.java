package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Idempotency record for bot image messages.
 * The same private chat message must return the same quote instead of creating duplicates.
 */
@Getter
@Setter
@Entity
@Table(uniqueConstraints = {
        @UniqueConstraint(name = "uk_bot_message_wechat_message", columnNames = {"wechatId", "messageId"})
})
public class BotMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String wechatId;

    @Column(nullable = false, length = 128)
    private String messageId;

    @Column(nullable = false, length = 64)
    private String customerNo;

    @Column(nullable = false, length = 64)
    private String quoteNo;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        createdAt = LocalDateTime.now();
    }
}
