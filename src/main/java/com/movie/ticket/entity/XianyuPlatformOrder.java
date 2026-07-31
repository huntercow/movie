package com.movie.ticket.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@jakarta.persistence.EntityListeners(com.movie.ticket.shared.persistence.UserScopeEntityListener.class)
public class XianyuPlatformOrder implements com.movie.ticket.shared.persistence.UserScopedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @jakarta.persistence.Version
    private Long version;

    @Column(nullable = false, unique = true, length = 128)
    private String platformOrderId;

    @Column(length = 128)
    private String tradeNo;

    @Column(nullable = false, length = 128)
    private String chatId;

    @Column(length = 128)
    private String buyerUserId;

    @Column(length = 128)
    private String sellerUserId;

    @Column(length = 128)
    private String itemId;

    @Column(length = 64)
    private String quoteNo;

    @Column(length = 64)
    private String localOrderNo;

    @Column(precision = 12, scale = 2)
    private BigDecimal paidAmount;

    @Column(precision = 12, scale = 2)
    private BigDecimal quotedAmount;

    @Column(precision = 12, scale = 2)
    private BigDecimal adjustedAmount;

    private LocalDateTime adjustedAt;

    @Enumerated(EnumType.STRING)
    @Column(length = 64)
    private XianyuAmountVerificationSource amountVerificationSource;

    private LocalDateTime amountVerifiedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private XianyuFulfillmentStatus status;

    @Column(length = 1024)
    private String lastError;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    private LocalDateTime paidAt;
    private LocalDateTime deliveryClaimedAt;
    @Column(length = 64)
    private String deliveryAttemptId;
    private LocalDateTime deliveryAttemptStartedAt;
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private XianyuDeliveryAttemptOutcome deliveryAttemptOutcome;
    @Column(length = 64)
    private String deliveryAttemptChannel;
    @Column(length = 1024)
    private String deliveryAttemptErrorMessage;
    private LocalDateTime deliveryOutcomeRecordedAt;
    private LocalDateTime deliveredAt;

    @PrePersist
    void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
