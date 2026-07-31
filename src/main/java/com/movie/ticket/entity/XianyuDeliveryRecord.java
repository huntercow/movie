package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@jakarta.persistence.EntityListeners(com.movie.ticket.shared.persistence.UserScopeEntityListener.class)
public class XianyuDeliveryRecord implements com.movie.ticket.shared.persistence.UserScopedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(nullable = false, length = 128)
    private String platformOrderId;

    @Column(length = 64)
    private String deliveryAttemptId;

    @Column(length = 64)
    private String localOrderNo;

    @Column(nullable = false)
    private boolean success;

    @Column(length = 64)
    private String channel;

    @Column(length = 1024)
    private String errorMessage;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        createdAt = LocalDateTime.now();
    }
}
