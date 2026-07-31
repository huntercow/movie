package com.movie.ticket.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@jakarta.persistence.EntityListeners(com.movie.ticket.shared.persistence.UserScopeEntityListener.class)
public class TicketOrder implements com.movie.ticket.shared.persistence.UserScopedEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Version
    private Long version;

    @Column(nullable = false, unique = true, length = 64)
    private String orderNo;
    @Column(nullable = false, length = 64)
    private String quoteNo;
    @Column(nullable = false, length = 64)
    private String customerId;
    @Column(unique = true, length = 128)
    private String paymentNo;
    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal finalPrice;
    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal totalPrice;
    private String upstreamOrderNo;
    private Integer submitRetryCount;
    @Column(length = 1024)
    private String lastSubmitError;
    private String upstreamOrderId;
    @Lob
    private String upstreamSubmitRequest;
    @Lob
    private String upstreamSubmitResponse;
    @Lob
    private String upstreamPayRequest;
    @Lob
    private String upstreamPayResponse;
    @Lob
    private String upstreamCancelRequest;
    @Lob
    private String upstreamCancelResponse;
    @Lob
    private String upstreamDetailResponse;
    private Integer upstreamOrderStatus;
    @Lob
    private String ticketCodeInfo;
    @Column(length = 1024)
    private String lastSyncError;
    private LocalDateTime submittedAt;
    private LocalDateTime paidAt;
    private LocalDateTime canceledAt;
    private LocalDateTime lastSyncAt;
    private LocalDateTime issuedAt;
    private LocalDateTime refundedAt;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private OrderStatus status;
    @Column(nullable = false)
    private LocalDateTime createdAt;
    @Column(nullable = false)
    private LocalDateTime updatedAt;

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
