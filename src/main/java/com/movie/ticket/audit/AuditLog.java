package com.movie.ticket.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long actorUserId;

    private Long targetUserId;

    @Column(nullable = false, length = 128)
    private String action;

    @Column(length = 64)
    private String resourceType;

    @Column(length = 128)
    private String resourceId;

    @Lob
    private String beforeJson;

    @Lob
    private String afterJson;

    @Column(length = 64)
    private String ipAddress;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
